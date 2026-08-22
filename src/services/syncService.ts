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
    const results: SyncItemResult[] = [];
    this.queue.requeueStaleProcessing();
    const pendingCount = this.queue.getPendingCount();

    if (pendingCount === 0) {
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
      const pendingItems = this.queue.getPendingItems();
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

    let shouldStop = false;
    while (!shouldStop) {
      // Claim in bounded batches so another MCP process can work on the rest
      // and a large offline queue does not become one giant in-memory batch.
      const pendingItems = this.queue.claimPendingItems(50);
      if (pendingItems.length === 0) break;

      for (const item of pendingItems) {
        try {
        if (item.type === 'demanda') {
          const response = await this.apiClient.createDemanda(item.payload);
          const remoteId = response.id;

          if (item.id) {
            this.queue.markSynced(item.id, remoteId);
          }

          // A API web não persiste sprint_id no cadastro da demanda; a
          // associação exige o endpoint próprio da sprint. Como o item offline
          // declarou a sprint, vincula agora que o ID remoto existe.
          if (remoteId && item.payload.sprint_id) {
            try {
              await this.apiClient.addDemandaToSprint(
                Number(item.payload.sprint_id),
                remoteId
              );
            } catch {
              // A demanda foi criada; a associação à sprint falhou sem
              // invalidar a sincronização.
            }
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
            } else {
              // The bounded recent map is only an optimization. Resolve an
              // older dependency directly by its unique local client ID.
              const syncedDemand = this.queue.getItemByClientId(rawDemandaId);
              if (syncedDemand?.remote_id) {
                demandaId = syncedDemand.remote_id;
              }
            }
            if (!demandaId && !isNaN(Number(rawDemandaId))) {
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

          // If network went down in middle of sync, release the claimed item
          // and leave the remaining queue items for the next attempt.
          if (err instanceof NetworkError) {
            shouldStop = true;
            break;
          }
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
