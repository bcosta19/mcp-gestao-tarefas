import { ApiClient } from '../services/apiClient.js';
import { OfflineQueue } from '../services/offlineQueue.js';
import { SyncService } from '../services/syncService.js';

export function registerSyncTools(
  server: any,
  apiClient: ApiClient,
  queue: OfflineQueue,
  syncService: SyncService
) {
  server.tool(
    'sincronizar_fila_offline',
    'Força o envio de todas as demandas e subtarefas que foram geradas localmente enquanto desconectado da VPN/intranet.',
    {},
    async () => {
      const pendingCount = queue.getPendingCount();
      if (pendingCount === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'nada_pendente',
                  mensagem: 'Não há itens pendentes na fila offline para sincronizar.',
                  estatisticas: {
                    pendentes: 0,
                    falhas: queue.getFailedCount(),
                    sincronizados: queue.getSyncedCount(),
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const syncResult = await syncService.sync();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: syncResult.failed === 0 ? 'sucesso' : 'parcial',
                mensagem: `Sincronização concluída: ${syncResult.succeeded} itens enviados com sucesso, ${syncResult.failed} falhas.`,
                resultado: syncResult,
                fila_restante: {
                  pendentes: queue.getPendingCount(),
                  falhas: queue.getFailedCount(),
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    'verificar_status_conexao',
    'Informa o estado da conexão com a API da intranet, a validade do token de autenticação e a quantidade de itens na fila offline pendente.',
    {},
    async () => {
      const conn = await apiClient.checkConnection();
      const pendentes = queue.getPendingCount();
      const falhas = queue.getFailedCount();
      const sincronizados = queue.getSyncedCount();

      const statusGeral = {
        intranet_conectada: conn.connected,
        usuario_autenticado: conn.connected && conn.user ? conn.user : null,
        mensagem_conexao: conn.connected
          ? 'Conexão ativa e autenticada com sucesso na API Gestão de Tarefas.'
          : `Desconectado da API: ${conn.error}`,
        fila_offline: {
          pendentes,
          falhas,
          sincronizados,
          total_armazenado: pendentes + falhas + sincronizados,
        },
        recomendacao:
          !conn.connected && pendentes > 0
            ? 'Você está offline. Todas as demandas e subtarefas criadas serão armazenadas na fila local e enviadas quando você reconectar à VPN.'
            : conn.connected && pendentes > 0
            ? 'Você está conectado e possui itens offline pendentes. Execute a ferramenta "sincronizar_fila_offline" para enviá-los.'
            : 'Sistema pronto para operações normais.',
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(statusGeral, null, 2),
          },
        ],
      };
    }
  );
}
