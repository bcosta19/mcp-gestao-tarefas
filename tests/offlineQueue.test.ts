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

  it('should persist the sprint cache and reload it across instances', () => {
    queue.saveSprints([
      { id: 27, nome: 'Sprint 8.0', data_inicio: '2026-08-01', data_fim: '2026-08-31', status: 'ativa' },
      { id: 26, nome: 'Sprint 7.0', data_inicio: '2026-07-01', data_fim: '2026-07-31', status: 'concluida' },
    ]);

    expect(queue.getSprintCount()).toBe(2);
    const sprints = queue.getSprints();
    expect(sprints).toHaveLength(2);
    // Ordenadas pela data fim mais recente primeiro.
    expect(sprints[0].id).toBe(27);
    expect(sprints[0].data_inicio).toBe('2026-08-01');
    expect(sprints[0].data_fim).toBe('2026-08-31');
    expect(sprints[0].status).toBe('ativa');
    expect(sprints[0].fetched_at).toBeDefined();

    // Persistência entre instâncias.
    queue.close();
    const newQueue = new OfflineQueue(dbPath);
    expect(newQueue.getSprintCount()).toBe(2);
    expect(newQueue.getSprints()[0].id).toBe(27);
    newQueue.close();
  });

  it('should upsert sprints and clear the cache', () => {
    queue.saveSprints([{ id: 27, nome: 'Sprint 8.0', data_inicio: '2026-08-01', data_fim: '2026-08-31' }]);
    // Mesmo id: atualiza em vez de duplicar.
    queue.saveSprints([{ id: 27, nome: 'Sprint 8.0 (replanejada)', data_inicio: '2026-08-05', data_fim: '2026-09-05', status: 'ativa' }]);
    expect(queue.getSprintCount()).toBe(1);

    const updated = queue.getSprints()[0];
    expect(updated.nome).toBe('Sprint 8.0 (replanejada)');
    expect(updated.data_inicio).toBe('2026-08-05');
    expect(updated.data_fim).toBe('2026-09-05');

    queue.clearSprints();
    expect(queue.getSprintCount()).toBe(0);
  });
});
