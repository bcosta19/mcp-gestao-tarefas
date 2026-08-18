import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { OfflineQueue } from '../src/services/offlineQueue.js';

describe('OfflineQueue (SQLite)', () => {
  let tmpDir: string;
  let dbPath: string;
  let queue: OfflineQueue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-queue-test-'));
    dbPath = path.join(tmpDir, 'test-queue.sqlite');
    queue = new OfflineQueue(dbPath);
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should initialize sqlite table and insert pending items', () => {
    const payload = {
      titulo: 'Criar migration de usuários',
      projeto_id: 1,
      prioridade: 'Alta',
    };

    const item = queue.enqueue('demanda', payload);

    expect(item.id).toBeDefined();
    expect(item.client_id).toMatch(/^local_demanda_/);
    expect(item.type).toBe('demanda');
    expect(item.status).toBe('pending');
    expect(item.payload).toEqual(payload);

    expect(queue.getPendingCount()).toBe(1);
    expect(queue.getFailedCount()).toBe(0);
    expect(queue.getSyncedCount()).toBe(0);
  });

  it('should retrieve pending items in FIFO order', () => {
    queue.enqueue('demanda', { titulo: 'Demanda 1', projeto_id: 1 });
    queue.enqueue('subtarefa', { titulo: 'Subtarefa 1.1', demanda_id: 1 });

    const pending = queue.getPendingItems();
    expect(pending).toHaveLength(2);
    expect(pending[0].payload.titulo).toBe('Demanda 1');
    expect(pending[1].payload.titulo).toBe('Subtarefa 1.1');
  });

  it('should mark item as synced with remote_id', () => {
    const item = queue.enqueue('demanda', { titulo: 'Demanda Online', projeto_id: 1 });
    queue.markSynced(item.id!, 404);

    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getSyncedCount()).toBe(1);

    const fetched = queue.getItemById(item.id!);
    expect(fetched?.status).toBe('synced');
    expect(fetched?.remote_id).toBe(404);
  });

  it('should mark item as failed with error message', () => {
    const item = queue.enqueue('demanda', { titulo: 'Demanda Invalida', projeto_id: 1 });
    queue.markFailed(item.id!, 'Erro 422: Titulo obrigatorio');

    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getFailedCount()).toBe(1);

    const fetched = queue.getItemById(item.id!);
    expect(fetched?.status).toBe('failed');
    expect(fetched?.attempts).toBe(1);
    expect(fetched?.last_error).toBe('Erro 422: Titulo obrigatorio');
  });

  it('should persist data across instance reloads', () => {
    const item = queue.enqueue('demanda', { titulo: 'Demanda Persistida', projeto_id: 2 });
    queue.close();

    // Reopen database with new instance
    const newQueue = new OfflineQueue(dbPath);
    expect(newQueue.getPendingCount()).toBe(1);

    const retrieved = newQueue.getItemByClientId(item.client_id);
    expect(retrieved?.payload.titulo).toBe('Demanda Persistida');
    newQueue.close();
  });
});
