import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { QueueItem, Sprint } from '../types.js';

export interface CachedSprint extends Sprint {
  fetched_at: string;
}

export class OfflineQueue {
  private db: DatabaseSync;
  private isOpen: boolean = true;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Multiple MCP clients may share the same queue file. A bounded busy
    // timeout avoids failing immediately while another worker commits a short
    // transaction; WAL lets readers continue while a writer is active.
    this.db = new DatabaseSync(dbPath);
    // PRAGMA keeps compatibility with the project's Node 22.5 minimum; the
    // constructor `timeout` option was added only in later Node 22 releases.
    this.db.exec('PRAGMA busy_timeout = 5000');
    if (dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL');
    }
    this.initDb();
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS offline_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        remote_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_queue(status);
      CREATE INDEX IF NOT EXISTS idx_offline_queue_project_status
        ON offline_queue(status, json_extract(payload, '$.projeto_id'));

      CREATE TABLE IF NOT EXISTS sprint_cache (
        sprint_id INTEGER PRIMARY KEY,
        nome TEXT NOT NULL,
        data_inicio TEXT,
        data_fim TEXT,
        status TEXT,
        fetched_at TEXT NOT NULL
      );
    `);
  }

  /**
   * Persiste a lista de sprints recebida da API (ou recarregada do cache).
   * Usado pela persistência local de sprint para funcionar offline.
   */
  public saveSprints(sprints: Sprint[], fetchedAt?: Date): void {
    const at = (fetchedAt || new Date()).toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO sprint_cache (sprint_id, nome, data_inicio, data_fim, status, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sprint_id) DO UPDATE SET
        nome = excluded.nome,
        data_inicio = excluded.data_inicio,
        data_fim = excluded.data_fim,
        status = excluded.status,
        fetched_at = excluded.fetched_at
    `);

    for (const sprint of sprints) {
      if (!sprint.id) continue;
      stmt.run(
        sprint.id,
        sprint.nome || '',
        sprint.data_inicio || null,
        sprint.data_fim || null,
        sprint.status || null,
        at
      );
    }
  }

  public getSprints(): CachedSprint[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sprint_cache
      ORDER BY data_fim DESC, sprint_id DESC
    `);
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: Number(row.sprint_id),
      nome: String(row.nome),
      data_inicio: row.data_inicio ? String(row.data_inicio) : undefined,
      data_fim: row.data_fim ? String(row.data_fim) : undefined,
      status: row.status ? String(row.status) : undefined,
      fetched_at: String(row.fetched_at),
    }));
  }

  public getSprintCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM sprint_cache`);
    const row = stmt.get() as any;
    return Number(row?.count || 0);
  }

  public clearSprints(): void {
    this.db.exec('DELETE FROM sprint_cache');
  }

  public enqueue(
    type: 'demanda' | 'subtarefa',
    payload: Record<string, any>,
    clientId?: string
  ): QueueItem {
    const cId = clientId || `local_${type}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const payloadStr = JSON.stringify(payload);

    const stmt = this.db.prepare(`
      INSERT INTO offline_queue (client_id, type, payload, attempts, status, created_at, updated_at)
      VALUES (?, ?, ?, 0, 'pending', ?, ?)
    `);

    const result = stmt.run(cId, type, payloadStr, now, now);
    return {
      id: Number(result.lastInsertRowid),
      client_id: cId,
      type,
      payload,
      attempts: 0,
      status: 'pending',
      created_at: now,
      updated_at: now,
    };
  }

  public getPendingItems(): QueueItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM offline_queue
      WHERE status = 'pending'
      ORDER BY id ASC
    `);

    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      id: Number(row.id),
      client_id: String(row.client_id),
      type: row.type as 'demanda' | 'subtarefa',
      payload: JSON.parse(String(row.payload)),
      attempts: Number(row.attempts),
      last_error: row.last_error ? String(row.last_error) : null,
      status: row.status,
      remote_id: row.remote_id ? Number(row.remote_id) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }));
  }

  /**
   * Atomically reserves a bounded batch for one sync worker. The status change
   * happens before any network await, so overlapping workers cannot send the
   * same queue item twice.
   */
  public claimPendingItems(limit: number = 50): QueueItem[] {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 500));
    this.requeueStaleProcessing();

    const now = new Date().toISOString();
    const claimedRows: any[] = [];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const rows = this.db
        .prepare(
          `SELECT * FROM offline_queue
           WHERE status = 'pending'
           ORDER BY id ASC
           LIMIT ?`
        )
        .all(boundedLimit) as any[];
      const update = this.db.prepare(
        `UPDATE offline_queue
         SET status = 'processing', updated_at = ?
         WHERE id = ? AND status = 'pending'`
      );

      for (const row of rows) {
        const result = update.run(now, row.id) as any;
        if (Number(result.changes || 0) === 1) {
          row.status = 'processing';
          row.updated_at = now;
          claimedRows.push(row);
        }
      }

      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Preserve the original transaction error.
      }
      throw error;
    }

    return claimedRows.map((row) => this.toQueueItem(row));
  }

  /** Requeues items left in processing after a worker crashed or timed out. */
  public requeueStaleProcessing(staleAfterMs: number = 5 * 60 * 1000): void {
    const cutoff = new Date(Date.now() - Math.max(0, staleAfterMs)).toISOString();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE offline_queue
         SET status = 'pending', updated_at = ?
         WHERE status = 'processing' AND updated_at < ?`
      )
      .run(now, cutoff);
  }

  public getPendingCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM offline_queue WHERE status = 'pending'`);
    const row = stmt.get() as any;
    return Number(row?.count || 0);
  }

  public getPendingItemsForProject(projectId: number): QueueItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM offline_queue
         WHERE status = 'pending'
           AND json_extract(payload, '$.projeto_id') = ?
         ORDER BY id ASC`
      )
      .all(projectId) as any[];
    return rows.map((row) => this.toQueueItem(row));
  }

  public getFailedCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM offline_queue WHERE status = 'failed'`);
    const row = stmt.get() as any;
    return Number(row?.count || 0);
  }

  public getSyncedCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM offline_queue WHERE status = 'synced'`);
    const row = stmt.get() as any;
    return Number(row?.count || 0);
  }

  public getItemById(id: number): QueueItem | null {
    const stmt = this.db.prepare(`SELECT * FROM offline_queue WHERE id = ?`);
    const row = stmt.get(id) as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      client_id: String(row.client_id),
      type: row.type as 'demanda' | 'subtarefa',
      payload: JSON.parse(String(row.payload)),
      attempts: Number(row.attempts),
      last_error: row.last_error ? String(row.last_error) : null,
      status: row.status,
      remote_id: row.remote_id ? Number(row.remote_id) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  public getItemByClientId(clientId: string): QueueItem | null {
    const stmt = this.db.prepare(`SELECT * FROM offline_queue WHERE client_id = ?`);
    const row = stmt.get(clientId) as any;
    if (!row) return null;
    return {
      id: Number(row.id),
      client_id: String(row.client_id),
      type: row.type as 'demanda' | 'subtarefa',
      payload: JSON.parse(String(row.payload)),
      attempts: Number(row.attempts),
      last_error: row.last_error ? String(row.last_error) : null,
      status: row.status,
      remote_id: row.remote_id ? Number(row.remote_id) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  public markSynced(id: number, remoteId?: number): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE offline_queue
      SET status = 'synced', remote_id = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'processing')
    `);
    stmt.run(remoteId ?? null, now, id);
  }

  public markFailed(id: number, errorMessage: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE offline_queue
      SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'processing')
    `);
    stmt.run(errorMessage, now, id);
  }

  public incrementAttempts(id: number, errorMessage?: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE offline_queue
      SET status = 'pending', attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'processing')
    `);
    stmt.run(errorMessage || null, now, id);
  }

  public listAll(limit: number = 50): QueueItem[] {
    const stmt = this.db.prepare(`
      SELECT * FROM offline_queue
      ORDER BY id DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map((row) => ({
      id: Number(row.id),
      client_id: String(row.client_id),
      type: row.type as 'demanda' | 'subtarefa',
      payload: JSON.parse(String(row.payload)),
      attempts: Number(row.attempts),
      last_error: row.last_error ? String(row.last_error) : null,
      status: row.status,
      remote_id: row.remote_id ? Number(row.remote_id) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }));
  }

  public clear(): void {
    this.db.exec('DELETE FROM offline_queue');
  }

  public close(): void {
    if (this.isOpen) {
      try {
        this.db.close();
      } catch {
        // already closed
      }
      this.isOpen = false;
    }
  }

  private toQueueItem(row: any): QueueItem {
    return {
      id: Number(row.id),
      client_id: String(row.client_id),
      type: row.type as 'demanda' | 'subtarefa',
      payload: JSON.parse(String(row.payload)),
      attempts: Number(row.attempts),
      last_error: row.last_error ? String(row.last_error) : null,
      status: row.status as QueueItem['status'],
      remote_id: row.remote_id ? Number(row.remote_id) : null,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }
}
