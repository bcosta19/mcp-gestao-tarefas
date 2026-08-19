import fs from 'fs';
import path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { ConfigFile, Projeto } from '../types.js';
import { ApiClient } from './apiClient.js';
import { AppConfig, config as globalConfig } from '../config.js';

export interface ResolvedProject {
  id?: number;
  nome: string;
  departamento?: string;
  source: 'config_file' | 'git_remote' | 'folder_name' | 'manual';
  configPath?: string;
  repoUrl?: string;
  folderName?: string;
  ignorado?: boolean;
  motivo_desativacao?: string;
  tipo?: string;
}

export class ContextDetector {
  private apiClient?: ApiClient;
  private ignorePrefeitura: boolean;
  private ignoredPatterns: string[];

  constructor(apiClient?: ApiClient, options?: Partial<AppConfig>) {
    this.apiClient = apiClient;
    this.ignorePrefeitura =
      options?.ignorePrefeitura !== undefined
        ? options.ignorePrefeitura
        : globalConfig.ignorePrefeitura;
    this.ignoredPatterns = options?.ignoredPatterns || globalConfig.ignoredPatterns;
  }

  /**
   * Verifica se uma string ou metadados correspondem a um projeto que deve ser ignorado.
   */
  public isPrefeituraOrIgnored(
    nameOrPath: string,
    extraInfo?: { departamento?: string; tipo?: string; repoUrl?: string }
  ): { ignored: boolean; reason?: string } {
    const targets = [
      nameOrPath,
      extraInfo?.departamento,
      extraInfo?.tipo,
      extraInfo?.repoUrl,
    ]
      .filter(Boolean)
      .map((s) => s!.toLowerCase());

    if (extraInfo?.tipo === 'externo') {
      return {
        ignored: true,
        reason: `Projeto classificado explicitamente como '${extraInfo.tipo}'. Eventos e registro de tarefas desativados.`,
      };
    }

    if (!this.ignorePrefeitura) {
      return { ignored: false };
    }

    for (const pattern of this.ignoredPatterns) {
      const cleanPattern = pattern.toLowerCase().trim();
      for (const target of targets) {
        if (target.includes(cleanPattern)) {
          return {
            ignored: true,
            reason: `Projeto ignorado por corresponder ao padrão '${pattern}'. O registro de eventos no Gestão de Tarefas está desativado.`,
          };
        }
      }
    }

    return { ignored: false };
  }

  /**
   * Search for .gestaotarefas.json walking up from directory to filesystem root
   */
  public findConfigFile(startDir: string): { config: ConfigFile; filePath: string } | null {
    let currentDir = path.resolve(startDir);

    while (true) {
      const targetPath = path.join(currentDir, '.gestaotarefas.json');
      const altTargetPath = path.join(currentDir, '.gestao-tarefas.json');

      for (const fPath of [targetPath, altTargetPath]) {
        if (fs.existsSync(fPath)) {
          try {
            const content = fs.readFileSync(fPath, 'utf8');
            const parsed = JSON.parse(content) as ConfigFile;
            if (
              parsed &&
              (typeof parsed.projeto_id === 'number' ||
                parsed.ignorado === true ||
                parsed.desativado === true ||
                parsed.tipo === 'prefeitura' ||
                parsed.tipo === 'externo' ||
                parsed.tipo === 'interno')
            ) {
              return { config: parsed, filePath: fPath };
            }
          } catch (e) {
            // ignore corrupted json and continue upwards
          }
        }
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    return null;
  }

  /**
   * Extract repository info from git in directory
   */
  public async getGitInfo(targetDir: string): Promise<{
    isGit: boolean;
    remoteUrl?: string;
    repoName?: string;
    folderName: string;
  }> {
    const folderName = path.basename(path.resolve(targetDir));
    const gitDir = path.join(path.resolve(targetDir), '.git');

    if (!fs.existsSync(gitDir)) {
      return { isGit: false, folderName };
    }

    try {
      const git: SimpleGit = simpleGit(targetDir);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) {
        return { isGit: false, folderName };
      }

      const remotes = await git.getRemotes(true);
      const origin = remotes.find((r) => r.name === 'origin') || remotes[0];
      const remoteUrl = origin?.refs?.fetch || origin?.refs?.push;

      let repoName: string | undefined;
      if (remoteUrl) {
        // e.g. https://github.com/org/repo-name.git or git@github.com:org/repo-name.git
        const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
        if (match && match[1]) {
          repoName = match[1];
        }
      }

      return {
        isGit: true,
        remoteUrl,
        repoName: repoName || folderName,
        folderName,
      };
    } catch {
      return { isGit: false, folderName };
    }
  }

  /**
   * Resolve project context for given directory
   */
  public async detectProject(
    targetDir: string = process.cwd(),
    availableProjects?: Projeto[]
  ): Promise<ResolvedProject | null> {
    const resolvedDir = path.resolve(targetDir);

    // Camada 1: Arquivo .gestaotarefas.json
    const configResult = this.findConfigFile(resolvedDir);
    if (configResult) {
      const { config, filePath } = configResult;
      const isExplicitlyIgnored = config.ignorado === true || config.desativado === true;
      const prefeituraCheck = this.isPrefeituraOrIgnored(
        config.nome || path.basename(resolvedDir),
        { departamento: config.departamento, tipo: config.tipo }
      );

      const isIgnored = isExplicitlyIgnored || prefeituraCheck.ignored;
      const motivo =
        config.motivo ||
        (isExplicitlyIgnored
          ? 'Projeto marcado como ignorado/desativado no arquivo de configuração .gestaotarefas.json.'
          : prefeituraCheck.reason);

      return {
        id: config.projeto_id,
        nome: config.nome || `Projeto #${config.projeto_id || 'Externo'}`,
        departamento: config.departamento,
        tipo: config.tipo,
        source: 'config_file',
        configPath: filePath,
        ignorado: isIgnored,
        motivo_desativacao: isIgnored ? motivo : undefined,
      };
    }

    // Camada 2: Git e Nome da Pasta
    const gitInfo = await this.getGitInfo(resolvedDir);

    // Checa se o Git ou a pasta corresponde a um projeto explicitamente ignorado
    const gitPrefeituraCheck = this.isPrefeituraOrIgnored(
      gitInfo.repoName || gitInfo.folderName,
      { repoUrl: gitInfo.remoteUrl }
    );

    if (gitPrefeituraCheck.ignored) {
      return {
        nome: gitInfo.repoName || gitInfo.folderName,
        source: gitInfo.isGit ? 'git_remote' : 'folder_name',
        folderName: gitInfo.folderName,
        repoUrl: gitInfo.remoteUrl,
        ignorado: true,
        motivo_desativacao: gitPrefeituraCheck.reason,
      };
    }

    let projects = availableProjects;

    if (!projects && this.apiClient) {
      try {
        projects = await this.apiClient.listProjetos();
      } catch {
        // offline or error
        projects = [];
      }
    }

    if (projects && projects.length > 0) {
      // 1. Tenta match por URL do remote
      if (gitInfo.remoteUrl) {
        const remoteUrl = gitInfo.remoteUrl;
        const matchByRepo = projects.find(
          (p) =>
            p.repositorio &&
            (remoteUrl.includes(p.repositorio) ||
              p.repositorio.includes(remoteUrl))
        );
        if (matchByRepo) {
          const matchCheck = this.isPrefeituraOrIgnored(matchByRepo.nome, {
            departamento: matchByRepo.departamento,
            repoUrl: matchByRepo.repositorio,
          });
          return {
            id: matchByRepo.id,
            nome: matchByRepo.nome,
            departamento: matchByRepo.departamento,
            source: 'git_remote',
            repoUrl: remoteUrl,
            ignorado: matchCheck.ignored,
            motivo_desativacao: matchCheck.reason,
          };
        }
      }

      // 2. Tenta match por nome do repositório / nome da pasta (case-insensitive, sem acentos e tratando stopwords)
      const stopwords = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'o', 'a', 'em', 'para', 'com']);

      const getTokens = (s: string): string[] =>
        s
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 0 && !stopwords.has(t));

      const getCleanConcat = (tokens: string[]): string => tokens.join('');

      const searchNames = [gitInfo.repoName, gitInfo.folderName].filter(Boolean) as string[];
      const searchTokensList = searchNames.map((n) => ({
        raw: n,
        tokens: getTokens(n),
        concat: getCleanConcat(getTokens(n)),
      }));

      for (const p of projects) {
        const pTokens = getTokens(p.nome);
        const pConcat = getCleanConcat(pTokens);

        const isMatch = searchTokensList.some(({ tokens, concat }) => {
          if (!concat || !pConcat) return false;
          // Exact clean match
          if (concat === pConcat || concat.includes(pConcat) || pConcat.includes(concat)) {
            return true;
          }
          // All tokens match
          if (
            tokens.length > 0 &&
            pTokens.length > 0 &&
            (tokens.every((t) => pTokens.includes(t)) || pTokens.every((t) => tokens.includes(t)))
          ) {
            return true;
          }
          return false;
        });

        if (isMatch) {
          const matchCheck = this.isPrefeituraOrIgnored(p.nome, {
            departamento: p.departamento,
            repoUrl: p.repositorio,
          });
          return {
            id: p.id,
            nome: p.nome,
            departamento: p.departamento,
            source: 'folder_name',
            folderName: gitInfo.folderName,
            ignorado: matchCheck.ignored,
            motivo_desativacao: matchCheck.reason,
          };
        }
      }
    }

    return null;
  }

  /**
   * Helper to write .gestaotarefas.json configuration file
   */
  public saveConfigFile(
    targetDir: string,
    config: {
      projeto_id?: number;
      nome: string;
      departamento?: string;
      ignorado?: boolean;
      tipo?: string;
      motivo?: string;
    }
  ): string {
    const filePath = path.join(path.resolve(targetDir), '.gestaotarefas.json');
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    return filePath;
  }
}
