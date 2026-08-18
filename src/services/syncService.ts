import { ApiClient, NetworkError } from './apiClient.js';
import { OfflineQueue } from './offlineQueue.js';
import { SyncItemResult, SyncResult } from '../types.js';

export class SyncService {
  private apiClient: ApiClient;
  private queue: OfflineQueue;

  constructor(apiClient: ApiClient, queue: OfflineQueue) {
    this.apiClient = apiClient;
    this.queue = queue;
  }

  public async sync(): Promise<SyncResult> {
    const pendingItems = this.queue.getPendingItems();
    const results: SyncItemResult[] = [];

    if (pendingItems.length === 0) {
      return {
        total_processed: 0,
        succeeded: 0,
        failed: 0,
        items: [],
      };
    }

    // Check connectivity first
    const conn = await this.apiClient.checkConnection();
    if (!conn.connected) {
      return {
        total_processed: 0,
        succeeded: 0,
        failed: pendingItems.length,
        items: pendingItems.map((item) => ({
          id: item.id,
          client_id: item.client_id,
          type: item.type,
          status: 'failed',
          error: `Conexão indisponível: ${conn.error || 'VPN/Intranet desconectada.'}`,
        })),
      };
    }

    // Map to track local/client IDs to remote IDs
    const idMap = new Map<string, number>();

    // Also preload any previously synced items from queue that have remote_id
    const allSynced = this.queue.listAll(200).filter((i) => i.status === 'synced' && i.remote_id);
    for (const synced of allSynced) {
      if (synced.remote_id) {
        idMap.set(synced.client_id, synced.remote_id);
        if (synced.id) {
          idMap.set(String(synced.id), synced.remote_id);
        }
      }
    }

    let succeeded = 0;
    let failed = 0;

    for (const item of pendingItems) {
      try {
        if (item.type === 'demanda') {
          const response = await this.apiClient.createDemanda(item.payload);
          const remoteId = response.id;

          if (item.id) {
            this.queue.markSynced(item.id, remoteId);
          }

          if (remoteId) {
            idMap.set(item.client_id, remoteId);
            if (item.id) {
              idMap.set(String(item.id), remoteId);
            }
          }

          results.push({
            id: item.id,
            client_id: item.client_id,
            type: 'demanda',
            status: 'synced',
            remote_id: remoteId,
          });
          succeeded++;
        } else if (item.type === 'subtarefa') {
          let demandaId: number | undefined;
          const rawDemandaId = item.payload.demanda_id;

          if (typeof rawDemandaId === 'number') {
            demandaId = rawDemandaId;
          } else if (typeof rawDemandaId === 'string') {
            if (idMap.has(rawDemandaId)) {
              demandaId = idMap.get(rawDemandaId);
            } else if (!isNaN(Number(rawDemandaId))) {
              demandaId = Number(rawDemandaId);
            }
          }

          if (!demandaId) {
            const errorMsg = `Não foi possível resolver o ID da demanda remota (${rawDemandaId}) para a subtarefa.`;
            if (item.id) {
              this.queue.markFailed(item.id, errorMsg);
            }
            results.push({
              id: item.id,
              client_id: item.client_id,
              type: 'subtarefa',
              status: 'failed',
              error: errorMsg,
            });
            failed++;
            continue;
          }

          const response = await this.apiClient.createSubtarefa(demandaId, {
            titulo: item.payload.titulo || 'Subtarefa',
            descricao: item.payload.descricao,
            data_limite: item.payload.data_limite,
            responsaveis: item.payload.responsaveis,
            responsavel_id: item.payload.responsavel_id,
          });
          const remoteSubtaskId = response.id;

          if (item.id) {
            this.queue.markSynced(item.id, remoteSubtaskId);
          }

          results.push({
            id: item.id,
            client_id: item.client_id,
            type: 'subtarefa',
            status: 'synced',
            remote_id: remoteSubtaskId,
          });
          succeeded++;
        }
      } catch (err: any) {
        const errorMsg = err.message || 'Erro durante a sincronização.';
        if (item.id) {
          if (err instanceof NetworkError) {
            this.queue.incrementAttempts(item.id, errorMsg);
          } else {
            this.queue.markFailed(item.id, errorMsg);
          }
        }

        results.push({
          id: item.id,
          client_id: item.client_id,
          type: item.type,
          status: 'failed',
          error: errorMsg,
        });
        failed++;

        // If network went down in middle of sync, abort loop
        if (err instanceof NetworkError) {
          break;
        }
      }
    }

    return {
      total_processed: succeeded + failed,
      succeeded,
      failed,
      items: results,
    };
  }
}
