import { z } from 'zod';
import { ApiClient, NetworkError, ValidationError } from '../services/apiClient.js';
import { OfflineQueue } from '../services/offlineQueue.js';
import { ContextDetector } from '../services/contextDetector.js';

export const CriarSubtarefaSchema = {
  demanda_id: z
    .union([z.number(), z.string()])
    .describe('ID numérico da demanda ou identificador offline (client_id) gerado para uma demanda criada sem conexão.'),
  titulo: z.string().min(1).max(255).describe('Título da subtarefa técnica a ser executada.'),
  descricao: z.string().optional().describe('Descrição técnica ou detalhamento dos passos da subtarefa.'),
  responsavel_id: z.number().optional().describe('ID do Colaborador responsável pela subtarefa.'),
  data_limite: z.string().optional().describe('Data limite de conclusão no formato YYYY-MM-DD.'),
  diretorio_path: z
    .string()
    .optional()
    .describe('Diretório do projeto a validar para regras de contexto (default: diretório atual do MCP).'),
};

export const AtualizarSubtarefaSchema = {
  subtarefa_id: z.number().describe('ID da subtarefa a ser atualizada.'),
  titulo: z.string().optional().describe('Novo título da subtarefa.'),
  descricao: z.string().optional().describe('Nova descrição da subtarefa.'),
  status: z.enum(['pendente', 'fazendo', 'concluida', 'cancelada']).optional().describe('Novo status da subtarefa.'),
  data_limite: z.string().optional().describe('Nova data limite YYYY-MM-DD.'),
};

export function registerSubtarefaTools(
  server: any,
  apiClient: ApiClient,
  queue: OfflineQueue,
  detector?: ContextDetector
) {
  server.tool(
    'criar_subtarefa',
    'Cria uma subtarefa técnica vinculada a uma demanda existente. Desativado para projetos da Prefeitura/externos. Se offline, armazena na fila local para posterior envio.',
    CriarSubtarefaSchema,
    async (params: any) => {
      const { diretorio_path: targetDir } = params;

      // 1. Verifica se o projeto atual é ignorado (Prefeitura / Externo)
      if (detector) {
        const detected = await detector.detectProject(targetDir || process.cwd());
        if (detected?.ignorado) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'desativado',
                    mcp_ativo: false,
                    mensagem:
                      detected.motivo_desativacao ||
                      'Operação cancelada: O projeto atual é da Prefeitura/externo e está desativado para criação de subtarefas e disparo de eventos.',
                    projeto: detected.nome,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      const payload = {
        demanda_id: params.demanda_id,
        titulo: params.titulo,
        descricao: params.descricao,
        responsavel_id: params.responsavel_id,
        data_limite: params.data_limite,
      };

      // Se demanda_id for string ou local_, ou se a API estiver offline, salva direto na fila offline
      const isLocalDemanda =
        typeof params.demanda_id === 'string' &&
        (params.demanda_id.startsWith('local_') || isNaN(Number(params.demanda_id)));

      if (isLocalDemanda) {
        const queued = queue.enqueue('subtarefa', payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'salvo_offline',
                  modo: 'offline_queue',
                  client_id: queued.client_id,
                  demanda_id: params.demanda_id,
                  mensagem:
                    'A demanda vinculada é um registro local ainda não sincronizado. A subtarefa foi gravada na fila offline e será sincronizada após a criação da demanda no servidor.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const numericDemandaId = Number(params.demanda_id);

      try {
        const result = await apiClient.createSubtarefa(numericDemandaId, payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'sucesso',
                  modo: 'online',
                  subtarefa_id: result.id,
                  demanda_id: numericDemandaId,
                  mensagem: result.message || 'Subtarefa criada com sucesso na API.',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        if (err instanceof ValidationError) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'erro_validacao',
                    mensagem: err.message,
                    erros: err.errors,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        if (err instanceof NetworkError || err.name === 'NetworkError' || !err.statusCode) {
          const queued = queue.enqueue('subtarefa', payload);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'salvo_offline',
                    modo: 'offline_queue',
                    client_id: queued.client_id,
                    demanda_id: numericDemandaId,
                    mensagem:
                      'A API da intranet está inacessível no momento. A subtarefa foi salva com segurança na fila offline local.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'erro',
                  mensagem: `Falha ao criar subtarefa: ${err.message}`,
                  detalhes: err.responseData,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.tool(
    'atualizar_subtarefa',
    'Atualiza campos de uma subtarefa (título, descrição, status ou data limite).',
    AtualizarSubtarefaSchema,
    async ({ subtarefa_id, ...data }: { subtarefa_id: number; [key: string]: any }) => {
      try {
        const result = await apiClient.updateSubtarefa(subtarefa_id, data);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'sucesso',
                  subtarefa_id,
                  mensagem: 'Subtarefa atualizada com sucesso.',
                  resultado: result,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'erro',
                  mensagem: `Não foi possível atualizar a subtarefa: ${err.message}`,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
