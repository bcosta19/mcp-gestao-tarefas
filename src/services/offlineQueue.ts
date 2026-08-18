import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { QueueItem } from '../types.js';

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

    this.db = new DatabaseSync(dbPath);
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
    `);
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

  public getPendingCount(): number {
    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM offline_queue WHERE status = 'pending'`);
    const row = stmt.get() as any;
    return Number(row?.count || 0);
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
      WHERE id = ?
    `);
    stmt.run(remoteId || null, now, id);
  }

  public markFailed(id: number, errorMessage: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE offline_queue
      SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(errorMessage, now, id);
  }

  public incrementAttempts(id: number, errorMessage?: string): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE offline_queue
      SET attempts = attempts + 1, last_error = ?, updated_at = ?
      WHERE id = ?
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
}
