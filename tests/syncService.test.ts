import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ApiClient } from '../src/services/apiClient.js';
import { OfflineQueue } from '../src/services/offlineQueue.js';
import { SyncService } from '../src/services/syncService.js';

describe('SyncService (Offline-to-Online Sync)', () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpDir: string;
  let queue: OfflineQueue;
  let apiClient: ApiClient;
  let syncService: SyncService;
  let createdDemandsCount = 0;
  let createdSubtasks: any[] = [];
  let sprintAssociations: Array<{ sprintId: number; demandaId: number }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);

      if (req.method === 'GET' && (url.pathname === '/api/user' || url.pathname === '/user')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 1, name: 'Tester', email: 'test@example.com' }));
        return;
      }

      if (req.method === 'POST' && (url.pathname === '/demandas' || url.pathname === '/api/demandas')) {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          if (parsed.titulo === 'Demanda Invalida') {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'Erro de validação' }));
            return;
          }
          createdDemandsCount++;
          const newId = 300 + createdDemandsCount;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, id: newId, message: 'Criado' }));
        });
        return;
      }

      const matchSub = url.pathname.match(/\/demandas\/(\d+)\/subtarefas/);
      if (req.method === 'POST' && matchSub) {
        const parentDemandaId = Number(matchSub[1]);
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          createdSubtasks.push({ parentDemandaId, ...parsed });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              id: 900 + createdSubtasks.length,
              subtarefa: { id: 900 + createdSubtasks.length, demanda_id: parentDemandaId },
            })
          );
        });
        return;
      }

      const matchSprint = url.pathname.match(/\/sprints\/(\d+)\/adicionar-demanda/);
      if (req.method === 'POST' && matchSprint) {
        const sprintId = Number(matchSprint[1]);
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          sprintAssociations.push({ sprintId, demandaId: Number(parsed.demanda_id) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Demanda associada à sprint.' }));
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sync-test-'));
    queue = new OfflineQueue(path.join(tmpDir, 'queue.sqlite'));
    apiClient = new ApiClient({
      apiUrl: baseUrl,
      apiToken: 'test-token',
      offlineQueuePath: path.join(tmpDir, 'queue.sqlite'),
      requestTimeoutMs: 2000,
    });
    syncService = new SyncService(apiClient, queue);
    createdDemandsCount = 0;
    createdSubtasks = [];
    sprintAssociations = [];
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return 0 processed if queue is empty', async () => {
    const result = await syncService.sync();
    expect(result.total_processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });

  it('should not send the same queue item twice when sync workers overlap', async () => {
    const secondQueue = new OfflineQueue(path.join(tmpDir, 'queue.sqlite'));
    queue.enqueue('demanda', {
      projeto_id: 1,
      titulo: 'Concurrent demand',
      descricao: 'Created once',
    });

    let createCalls = 0;
    const fakeApi = {
      checkConnection: async () => ({ connected: true }),
      createDemanda: async () => {
        createCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { success: true, id: 700 };
      },
    } as any;

    const firstWorker = new SyncService(fakeApi, queue);
    const secondWorker = new SyncService(fakeApi, secondQueue);
    const [firstResult, secondResult] = await Promise.all([
      firstWorker.sync(),
      secondWorker.sync(),
    ]);

    expect(createCalls).toBe(1);
    expect(firstResult.total_processed + secondResult.total_processed).toBe(1);
    secondQueue.close();
  });

  it('should sync pending demand and update status to synced with remote_id', async () => {
    const demand = queue.enqueue('demanda', {
      projeto_id: 1,
      titulo: 'Demanda Gerada Sem VPN',
      descricao: 'Descrição offline',
      prioridade: 'Alta',
    });

    expect(queue.getPendingCount()).toBe(1);

    const result = await syncService.sync();
    expect(result.total_processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getSyncedCount()).toBe(1);

    const syncedItem = queue.getItemById(demand.id!);
    expect(syncedItem?.status).toBe('synced');
    expect(syncedItem?.remote_id).toBe(301);
  });

  it('should correctly resolve temporary client_id of demand for subtasks during sync', async () => {
    // 1. Enqueue demand offline
    const demand = queue.enqueue('demanda', {
      projeto_id: 1,
      titulo: 'Nova Demanda Offline',
      descricao: 'Desc',
      prioridade: 'Média',
    });

    // 2. Enqueue subtask referencing the demand's client_id
    const subtask = queue.enqueue('subtarefa', {
      demanda_id: demand.client_id, // Linked to temporary local ID!
      titulo: 'Subtarefa vinculada localmente',
      descricao: 'Passo 1',
    });

    expect(queue.getPendingCount()).toBe(2);

    // 3. Perform sync
    const result = await syncService.sync();
    expect(result.total_processed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);

    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getSyncedCount()).toBe(2);

    // Verify subtask received the remote ID of the demand (301)
    expect(createdSubtasks).toHaveLength(1);
    expect(createdSubtasks[0].parentDemandaId).toBe(301);
    expect(createdSubtasks[0].titulo).toBe('Subtarefa vinculada localmente');
  });

  it('should resolve an old synced demand even when it is outside the recent mapping window', async () => {
    const demand = queue.enqueue('demanda', {
      projeto_id: 1,
      titulo: 'Old parent demand',
      descricao: 'Already synced',
    });
    queue.markSynced(demand.id!, 812);
    for (let index = 0; index < 205; index += 1) {
      const filler = queue.enqueue('demanda', {
        projeto_id: 1,
        titulo: `Filler ${index}`,
        descricao: 'Already synced',
      });
      queue.markSynced(filler.id!, 900 + index);
    }
    queue.enqueue('subtarefa', {
      demanda_id: demand.client_id,
      titulo: 'Child of old demand',
    });

    const createdParents: number[] = [];
    const fakeApi = {
      checkConnection: async () => ({ connected: true }),
      createSubtarefa: async (demandaId: number) => {
        createdParents.push(demandaId);
        return { success: true, id: 1001 };
      },
    } as any;

    const result = await new SyncService(fakeApi, queue).sync();

    expect(result.succeeded).toBe(1);
    expect(createdParents).toEqual([812]);
  });

  it('should associate a synced offline demand to its declared sprint', async () => {
    const demand = queue.enqueue('demanda', {
      projeto_id: 1,
      titulo: 'Demanda Criada Offline com Sprint',
      descricao: 'Descrição',
      prioridade: 'Alta',
      sprint_id: 2,
    });

    const result = await syncService.sync();
    expect(result.total_processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(queue.getSyncedCount()).toBe(1);

    const syncedItem = queue.getItemById(demand.id!);
    expect(sprintAssociations).toEqual([
      { sprintId: 2, demandaId: syncedItem?.remote_id },
    ]);
  });

  it('should mark invalid items as failed and proceed with valid items', async () => {
    // Enqueue 1 invalid demand and 1 valid demand
    queue.enqueue('demanda', {
      projeto_id: 1,
      titulo: 'Demanda Invalida',
      prioridade: 'Alta',
    });

    queue.enqueue('demanda', {
      projeto_id: 1,
      titulo: 'Demanda Valida',
      descricao: 'Ok',
      prioridade: 'Alta',
    });

    const result = await syncService.sync();
    expect(result.total_processed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);

    expect(queue.getFailedCount()).toBe(1);
    expect(queue.getSyncedCount()).toBe(1);
  });
});
