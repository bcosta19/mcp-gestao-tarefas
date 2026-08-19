import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ContextDetector } from '../src/services/contextDetector.js';
import { createServer } from '../src/server.js';
import { registerDemandaTools } from '../src/tools/demandaTools.js';
import { AppConfig } from '../src/config.js';

describe('Prefeitura & Ignored Projects Bypass', () => {
  let tmpDir: string;
  let baseConfig: AppConfig;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-prefeitura-test-'));
    baseConfig = {
      apiUrl: 'http://localhost:8000/api',
      apiToken: 'test-token',
      offlineQueuePath: path.join(tmpDir, 'queue.sqlite'),
      requestTimeoutMs: 2000,
      ignorePrefeitura: true,
      ignoredPatterns: ['pessoal', 'personal', 'externo'],
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ContextDetector: should identify project as ignored when .gestaotarefas.json has ignorado: true', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.gestaotarefas.json'),
      JSON.stringify({
        nome: 'Projeto Externo Particular',
        ignorado: true,
        motivo: 'Projeto fora do escopo de tarefas internas',
      })
    );

    const detector = new ContextDetector(undefined, baseConfig);
    const result = await detector.detectProject(tmpDir);

    expect(result).not.toBeNull();
    expect(result?.ignorado).toBe(true);
    expect(result?.motivo_desativacao).toContain('fora do escopo');
  });

  it('ContextDetector: should keep a prefeitura project active when tipo is prefeitura', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.gestaotarefas.json'),
      JSON.stringify({
        nome: 'Portal do Cidadão',
        tipo: 'prefeitura',
      })
    );

    const detector = new ContextDetector(undefined, baseConfig);
    const result = await detector.detectProject(tmpDir);

    expect(result).not.toBeNull();
    expect(result?.ignorado).toBe(false);
    expect(result?.motivo_desativacao).toBeUndefined();
  });

  it('ContextDetector: should not ignore prefeitura by folder name', async () => {
    const prefDir = path.join(tmpDir, 'prefeitura-saude-app');
    fs.mkdirSync(prefDir);

    const detector = new ContextDetector(undefined, baseConfig);
    const result = await detector.detectProject(prefDir);

    expect(result).toBeNull();
  });

  it('ContextDetector: should not ignore prefeitura by pmsp / pref- pattern', async () => {
    const prefDir = path.join(tmpDir, 'pmsp-portal-transparencia');
    fs.mkdirSync(prefDir);

    const detector = new ContextDetector(undefined, baseConfig);
    const result = await detector.detectProject(prefDir);

    expect(result).toBeNull();
  });

  it('ContextDetector: should ignore a personal project by configured pattern', async () => {
    const personalDir = path.join(tmpDir, 'personal-finance-app');
    fs.mkdirSync(personalDir);

    const detector = new ContextDetector(undefined, baseConfig);
    const result = await detector.detectProject(personalDir);

    expect(result).not.toBeNull();
    expect(result?.ignorado).toBe(true);
  });

  it('MCP Tools: prefeitura project remains active when explicitly configured', async () => {
    const prefDir = path.join(tmpDir, 'prefeitura-educacao');
    fs.mkdirSync(prefDir);

    const { detector, queue } = createServer(baseConfig);
    const detected = await detector.detectProject(prefDir);

    expect(detected).toBeNull();
    queue.close();
  });

  it('MCP Tools: should not ignore a prefeitura project', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.gestaotarefas.json'),
      JSON.stringify({
        nome: 'Sistema Prefeitura Municipal',
        tipo: 'prefeitura',
      })
    );

    const { detector, queue } = createServer(baseConfig);
    const detected = await detector.detectProject(tmpDir);
    expect(detected?.ignorado).toBe(false);

    // Verify queue is untouched and operations are blocked
    expect(queue.getPendingCount()).toBe(0);
    queue.close();
  });

  it('criar_demanda blocks an explicitly external project', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.gestaotarefas.json'),
      JSON.stringify({ nome: 'Sistema Externo Particular', tipo: 'externo' })
    );

    const { apiClient, queue, detector } = createServer(baseConfig);
    const handlers: Record<string, (params: any) => Promise<any>> = {};
    const fakeServer = {
      tool(name: string, _description: string, _schema: unknown, handler: (params: any) => Promise<any>) {
        handlers[name] = handler;
      },
    };

    registerDemandaTools(fakeServer, apiClient, queue, detector);
    const result = await handlers.criar_demanda({
      projeto_id: 1,
      titulo: 'Não deve ser enviada',
      descricao: 'Teste de bloqueio de contexto',
      prioridade: 'Alta',
      responsavel_id: 1,
      data_limite: '2026-08-30',
      diretorio_path: tmpDir,
    });

    expect(result.content[0].text).toContain('desativado');
    expect(queue.getPendingCount()).toBe(0);
    queue.close();
  });
});
