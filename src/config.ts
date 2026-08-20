import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import fs from 'fs';

dotenv.config();

export interface AppConfig {
  apiUrl: string;
  apiToken: string;
  email?: string;
  password?: string;
  offlineQueuePath: string;
  requestTimeoutMs: number;
  ignorePrefeitura: boolean;
  ignoredPatterns: string[];
}

function resolvePath(p: string): string {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

function loadGlobalUserConfig(): { apiUrl?: string; apiToken?: string; email?: string; password?: string } {
  try {
    const configFilePath = path.join(os.homedir(), '.gestao-tarefas-mcp', 'config.json');
    if (fs.existsSync(configFilePath)) {
      const content = fs.readFileSync(configFilePath, 'utf8');
      return JSON.parse(content);
    }
  } catch {
    // ignore
  }
  return {};
}

export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  const defaultQueuePath = path.join(os.homedir(), '.gestao-tarefas-mcp', 'queue.sqlite');
  const rawQueuePath = overrides?.offlineQueuePath || process.env.OFFLINE_QUEUE_PATH || defaultQueuePath;

  const globalUserCfg = loadGlobalUserConfig();

  // Projetos da Prefeitura são o caso principal de uso. A flag permanece
  // A variável antiga é aceita para não quebrar instalações existentes.
  const envIgnoreProjects =
    process.env.IGNORE_EXTERNAL_PROJECTS ??
    process.env.IGNORE_PREFEITURA ??
    process.env.GESTAO_TAREFAS_IGNORE_PREFEITURA ??
    'true';
  const envIgnoredPatterns = process.env.IGNORED_PROJECT_PATTERNS || 'pessoal,personal,externo';

  return {
    apiUrl: (
      overrides?.apiUrl ||
      process.env.GESTAO_TAREFAS_API_URL ||
      globalUserCfg.apiUrl ||
      ''
    ).replace(/\/+$/, ''),
    apiToken:
      overrides?.apiToken ||
      process.env.GESTAO_TAREFAS_API_TOKEN ||
      globalUserCfg.apiToken ||
      '',
    email: overrides?.email || process.env.GESTAO_TAREFAS_EMAIL || globalUserCfg.email || '',
    password: overrides?.password || process.env.GESTAO_TAREFAS_PASSWORD || globalUserCfg.password || '',
    offlineQueuePath: resolvePath(rawQueuePath),
    requestTimeoutMs: overrides?.requestTimeoutMs || Number(process.env.REQUEST_TIMEOUT_MS) || 5000,
    ignorePrefeitura:
      overrides?.ignorePrefeitura !== undefined
        ? overrides.ignorePrefeitura
        : envIgnoreProjects.toLowerCase() !== 'false',
    ignoredPatterns:
      overrides?.ignoredPatterns ||
      envIgnoredPatterns.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean),
  };
}

export const config = loadConfig();
