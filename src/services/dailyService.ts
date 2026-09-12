import fs from 'fs';
import os from 'os';
import path from 'path';
import { simpleGit } from 'simple-git';
import { AppConfig } from '../config.js';
import { ApiClient } from './apiClient.js';
import { ContextDetector } from './contextDetector.js';
import {
  DailyAtividadeGit,
  DailyCommit,
  DailyItemRascunho,
  DailyRascunho,
  DailySugestoes,
} from '../types.js';

export interface DailyRascunhoOptions {
  /** Data de referência no formato YYYY-MM-DD (default: hoje). */
  data?: string;
  /** Hora inicial da janela de atividade (HH:mm, default 00:00). */
  horaInicio?: string;
  /** Hora final da janela de atividade (HH:mm, default: agora ou 23:59). */
  horaFim?: string;
  /** Diretórios raiz a varrer em busca de repositórios git. */
  diretorios?: string[];
  /** Profundidade máxima de subpastas ao procurar repositórios (default 2). */
  maxDepth?: number;
  /** Desliga a varredura git (usa apenas as sugestões do servidor). */
  incluirGit?: boolean;
}

const DIRETORIOS_IGNORADOS = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  '.git',
]);

/**
 * Monta rascunhos pré-preenchidos da daily combinando as sugestões do
 * Gestão de Tarefas com a atividade git local do usuário no período.
 */
export class DailyService {
  constructor(
    private apiClient: ApiClient,
    private detector: ContextDetector,
    private config: AppConfig
  ) {}

  public async gerarRascunho(options: DailyRascunhoOptions = {}): Promise<DailyRascunho> {
    const data = options.data || this.hoje();
    const janela = this.janela(data, options.horaInicio, options.horaFim);
    const avisos: string[] = [];

    let sugestoes: DailySugestoes | null = null;
    try {
      sugestoes = await this.apiClient.getDailySugestoes({ data });
    } catch (err: any) {
      avisos.push(
        `Não foi possível carregar as sugestões do Gestão de Tarefas: ${err?.message || err}`
      );
    }

    let atividadeGit: DailyAtividadeGit[] = [];
    if (options.incluirGit !== false) {
      const roots = this.resolverDiretorios(options.diretorios);
      try {
        atividadeGit = await this.varrerAtividadeGit(
          roots,
          janela.inicio,
          janela.fim,
          options.maxDepth ?? 2
        );
      } catch (err: any) {
        avisos.push(`Falha ao varrer repositórios git: ${err?.message || err}`);
      }
    }

    return {
      data,
      janela: { inicio: janela.inicio.toISOString(), fim: janela.fim.toISOString() },
      sprint_id: sugestoes?.sprint_ativa?.id ?? null,
      usuario: sugestoes?.usuario,
      ja_registrada: sugestoes?.ja_registrada ?? null,
      ontem: this.montarOntem(sugestoes),
      hoje: this.montarHoje(sugestoes),
      observacoes: this.montarObservacoes(atividadeGit),
      impedimento_ids: (sugestoes?.impedimentos ?? []).map((i) => i.id),
      impedimentos: sugestoes?.impedimentos ?? [],
      atividade_git: atividadeGit,
      avisos,
    };
  }

  private hoje(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private janela(data: string, horaInicio?: string, horaFim?: string): { inicio: Date; fim: Date } {
    const inicio = new Date(`${data}T${this.normalizarHora(horaInicio, '00:00')}:00`);
    let fim: Date;

    if (horaFim) {
      fim = new Date(`${data}T${this.normalizarHora(horaFim, '23:59')}:00`);
    } else if (data === this.hoje()) {
      fim = new Date();
    } else {
      fim = new Date(`${data}T23:59:59`);
    }

    if (Number.isNaN(inicio.getTime())) {
      return { inicio: new Date(`${this.hoje()}T00:00:00`), fim: new Date() };
    }
    if (Number.isNaN(fim.getTime()) || fim < inicio) {
      fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000 - 1000);
    }

    return { inicio, fim };
  }

  private normalizarHora(hora: string | undefined, fallback: string): string {
    if (!hora) return fallback;
    const match = hora.trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return fallback;
    const h = String(Math.min(23, Math.max(0, Number(match[1])))).padStart(2, '0');
    const m = String(Math.min(59, Math.max(0, Number(match[2])))).padStart(2, '0');
    return `${h}:${m}`;
  }

  private resolverDiretorios(diretorios?: string[]): string[] {
    const base =
      diretorios && diretorios.length > 0 ? diretorios : this.config.dailyScanDirs;
    return base
      .map((dir) => this.expandirHome(dir))
      .filter((dir) => {
        try {
          return fs.existsSync(dir);
        } catch {
          return false;
        }
      });
  }

  private expandirHome(dir: string): string {
    const trimmed = dir.trim();
    if (trimmed.startsWith('~')) {
      return path.join(os.homedir(), trimmed.slice(1));
    }
    return path.resolve(trimmed);
  }

  private async varrerAtividadeGit(
    roots: string[],
    inicio: Date,
    fim: Date,
    maxDepth: number
  ): Promise<DailyAtividadeGit[]> {
    const repos = new Set<string>();
    for (const root of roots) {
      for (const repo of this.encontrarRepos(root, maxDepth)) {
        repos.add(repo);
      }
    }

    const atividades: DailyAtividadeGit[] = [];
    for (const repoDir of repos) {
      const atividade = await this.inspecionarRepo(repoDir, inicio, fim);
      if (atividade) atividades.push(atividade);
    }

    return atividades;
  }

  private encontrarRepos(root: string, maxDepth: number): string[] {
    const encontrados: string[] = [];

    const visitar = (dir: string, profundidade: number): void => {
      if (fs.existsSync(path.join(dir, '.git'))) {
        encontrados.push(dir);
        return;
      }
      if (profundidade <= 0) return;

      let entradas: fs.Dirent[];
      try {
        entradas = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entrada of entradas) {
        if (!entrada.isDirectory()) continue;
        if (entrada.name.startsWith('.') || DIRETORIOS_IGNORADOS.has(entrada.name)) continue;
        visitar(path.join(dir, entrada.name), profundidade - 1);
      }
    };

    visitar(root, maxDepth);
    return encontrados;
  }

  private async inspecionarRepo(
    repoDir: string,
    inicio: Date,
    fim: Date
  ): Promise<DailyAtividadeGit | null> {
    const git = simpleGit(repoDir);
    let commits: DailyCommit[] = [];

    try {
      const logOptions: Record<string, string> = {
        '--since': inicio.toISOString(),
        '--until': fim.toISOString(),
      };
      if (this.config.dailyGitAuthorEmail) {
        logOptions['--author'] = this.config.dailyGitAuthorEmail;
      }

      const log = await git.log(logOptions);
      commits = log.all.map((c) => ({
        hash: (c.hash || '').slice(0, 7),
        data: c.date,
        mensagem: (c.message || '').split('\n')[0].trim(),
        autor: c.author_name,
      }));
    } catch {
      return null;
    }

    let arquivosAlterados = 0;
    try {
      const status = await git.status();
      arquivosAlterados = status.files.length;
    } catch {
      arquivosAlterados = 0;
    }

    if (commits.length === 0 && arquivosAlterados === 0) {
      return null;
    }

    const detected = await this.detector.detectProject(repoDir).catch(() => null);

    return {
      repositorio: detected?.nome || path.basename(repoDir),
      caminho: repoDir,
      projeto: detected ? { id: detected.id, nome: detected.nome } : null,
      ignorado: detected?.ignorado === true,
      motivo_desativacao: detected?.motivo_desativacao,
      commits,
      arquivos_alterados: arquivosAlterados,
    };
  }

  private montarOntem(sugestoes: DailySugestoes | null): DailyItemRascunho[] {
    return (sugestoes?.ontem ?? []).slice(0, 25).map((s) => ({
      descricao: s.descricao,
      status: s.status,
      demanda_id: s.demanda_id ?? null,
      subtarefa_id: s.subtarefa_id ?? null,
      afazer_id: s.afazer_id ?? null,
    }));
  }

  private montarHoje(sugestoes: DailySugestoes | null): DailyItemRascunho[] {
    return (sugestoes?.hoje ?? []).slice(0, 25).map((s) => ({
      descricao: s.descricao,
      status: 'planejado',
      demanda_id: s.demanda_id ?? null,
      subtarefa_id: s.subtarefa_id ?? null,
      afazer_id: s.afazer_id ?? null,
    }));
  }

  private montarObservacoes(atividadeGit: DailyAtividadeGit[]): string[] {
    const observacoes: string[] = [];

    for (const atividade of atividadeGit) {
      if (atividade.ignorado) continue;

      const partes: string[] = [];
      if (atividade.commits.length > 0) {
        const assuntos = atividade.commits
          .slice(0, 3)
          .map((c) => c.mensagem)
          .filter(Boolean)
          .join('; ');
        partes.push(
          `${atividade.commits.length} commit(s)${assuntos ? ` — ${assuntos}` : ''}`
        );
      }
      if (atividade.arquivos_alterados > 0) {
        partes.push(`${atividade.arquivos_alterados} arquivo(s) em alteração`);
      }

      if (partes.length > 0) {
        observacoes.push(`${atividade.repositorio}: ${partes.join('; ')}`);
      }
    }

    return observacoes;
  }
}
