import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AppConfig } from '../src/config.js';
import { ApiClient } from '../src/services/apiClient.js';
import { ContextDetector } from '../src/services/contextDetector.js';
import { DailyService } from '../src/services/dailyService.js';
import { registerDailyTools } from '../src/tools/dailyTools.js';

function git(cwd: string, args: string, env?: Record<string, string>): void {
  execSync(`git ${args}`, { cwd, stdio: 'ignore', env: { ...process.env, ...(env || {}) } });
}

function criarRepo(root: string, nome: string, autor: string, mensagem: string): string {
  const dir = path.join(root, nome);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init -q');
  git(dir, `config user.email "${autor}"`);
  git(dir, 'config user.name "Dev Teste"');
  fs.writeFileSync(path.join(dir, 'arquivo.txt'), 'conteúdo');
  git(dir, 'add .');
  git(dir, `commit -q -m "${mensagem}"`);
  return dir;
}

function localHoje(): string {
  const n = new Date();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${n.getFullYear()}-${m}-${d}`;
}

function makeConfig(root: string, overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiUrl: 'http://localhost',
    apiToken: '',
    offlineQueuePath: path.join(root, 'queue.sqlite'),
    requestTimeoutMs: 1000,
    ignorePrefeitura: true,
    ignoredPatterns: ['pessoal', 'externo'],
    dailyScanDirs: [root],
    dailyGitAuthorEmail: 'dev@test.local',
    ...overrides,
  };
}

function fakeApi(sugestoes: any = {}): ApiClient {
  return {
    getDailySugestoes: async () => ({
      status: 'sucesso',
      data: localHoje(),
      usuario: { id: 1, nome: 'Dev Teste' },
      sprint_ativa: { id: 7, nome: 'Sprint 9.0' },
      ja_registrada: null,
      ontem: [
        {
          tipo: 'demanda',
          id: 104,
          descricao: 'Integração Microsoft OAuth',
          status: 'em_andamento',
          demanda_id: 104,
        },
      ],
      hoje: [
        {
          tipo: 'demanda',
          id: 104,
          descricao: 'Integração Microsoft OAuth',
          status: 'planejado',
          demanda_id: 104,
        },
      ],
      impedimentos: [
        { id: 9, titulo: 'VPN instável', status: 'aberto', prioridade: 'alta', demanda_id: 104 },
      ],
      ...sugestoes,
    }),
  } as unknown as ApiClient;
}

describe('DailyService - rascunho automático da daily', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-daily-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('combina sugestões do servidor com a atividade git da janela', async () => {
    criarRepo(root, 'projeto-alpha', 'dev@test.local', 'feat: ajusta fluxo de login');

    const detector = new ContextDetector(undefined, {
      ignorePrefeitura: true,
      ignoredPatterns: ['pessoal'],
    });
    const service = new DailyService(fakeApi(), detector, makeConfig(root));

    const hoje = localHoje();
    const rascunho = await service.gerarRascunho({
      data: hoje,
      horaInicio: '00:00',
      horaFim: '23:59',
    });

    expect(rascunho.data).toBe(hoje);
    expect(rascunho.sprint_id).toBe(7);
    expect(rascunho.ontem).toHaveLength(1);
    expect(rascunho.ontem[0].demanda_id).toBe(104);
    expect(rascunho.hoje).toHaveLength(1);
    expect(rascunho.impedimento_ids).toEqual([9]);

    expect(rascunho.atividade_git).toHaveLength(1);
    expect(rascunho.atividade_git[0].repositorio).toBe('projeto-alpha');
    expect(rascunho.atividade_git[0].commits.length).toBeGreaterThanOrEqual(1);
    expect(rascunho.observacoes[0]).toContain('projeto-alpha');
    expect(rascunho.observacoes[0]).toContain('login');
    expect(rascunho.avisos).toHaveLength(0);
  });

  it('ignora commits de outro autor na janela', async () => {
    criarRepo(root, 'projeto-beta', 'outro@test.local', 'chore: trabalho de outro dev');

    const detector = new ContextDetector(undefined, { ignorePrefeitura: true });
    const service = new DailyService(fakeApi(), detector, makeConfig(root));

    const rascunho = await service.gerarRascunho({
      data: localHoje(),
      horaInicio: '00:00',
      horaFim: '23:59',
    });

    expect(rascunho.atividade_git).toHaveLength(0);
    expect(rascunho.avisos).toHaveLength(0);
  });

  it('exclui projetos ignorados das observações, mas os reporta na atividade', async () => {
    const dir = criarRepo(root, 'projeto-pessoal', 'dev@test.local', 'feat: algo pessoal');
    fs.writeFileSync(
      path.join(dir, '.gestaotarefas.json'),
      JSON.stringify({ nome: 'projeto-pessoal', tipo: 'externo', ignorado: true })
    );

    const detector = new ContextDetector(undefined, { ignorePrefeitura: true });
    const service = new DailyService(fakeApi(), detector, makeConfig(root));

    const rascunho = await service.gerarRascunho({
      data: localHoje(),
      horaInicio: '00:00',
      horaFim: '23:59',
    });

    expect(rascunho.atividade_git).toHaveLength(1);
    expect(rascunho.atividade_git[0].ignorado).toBe(true);
    expect(rascunho.observacoes).toHaveLength(0);
  });

  it('degrada com aviso quando as sugestões do servidor falham', async () => {
    criarRepo(root, 'projeto-gama', 'dev@test.local', 'fix: corrige bug');

    const api = {
      getDailySugestoes: async () => {
        throw new Error('VPN desconectada');
      },
    } as unknown as ApiClient;

    const detector = new ContextDetector(undefined, { ignorePrefeitura: true });
    const service = new DailyService(api, detector, makeConfig(root));

    const rascunho = await service.gerarRascunho({
      data: localHoje(),
      horaInicio: '00:00',
      horaFim: '23:59',
    });

    expect(rascunho.ontem).toHaveLength(0);
    expect(rascunho.hoje).toHaveLength(0);
    expect(rascunho.atividade_git).toHaveLength(1);
    expect(rascunho.avisos.length).toBeGreaterThanOrEqual(1);
  });
});

describe('DailyTools - criar_daily', () => {
  it('registra a daily e devolve id/resumo', async () => {
    const handlers: Record<string, (params: any) => Promise<any>> = {};
    const fakeServer = {
      tool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: (params: any) => Promise<any>
      ) {
        handlers[name] = handler;
      },
    };

    const api = {
      createDaily: async (payload: any) => ({
        status: 'sucesso',
        id: 55,
        resumo: 'Ontem: 1 concluída(s), 0 em andamento — 1 tarefa planejada (hoje)',
        message: 'Daily registrada com sucesso.',
        // expõe o payload para inspeção
        _payload: payload,
      }),
    } as unknown as ApiClient;

    await registerDailyTools(fakeServer, api, {} as DailyService);

    const result = await handlers.criar_daily({
      data: '2026-09-11',
      ontem: [{ descricao: 'Avancei', status: 'em_andamento', demanda_id: 104 }],
      hoje: [{ descricao: 'Continuo', demanda_id: 104 }],
      observacoes: ['projeto-alpha: 1 commit(s)'],
      impedimento_ids: [9],
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('sucesso');
    expect(parsed.daily_id).toBe(55);
    expect(parsed.resumo).toContain('planejada');
  });
});
