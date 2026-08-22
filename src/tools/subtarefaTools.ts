import { z } from 'zod';
import { ApiClient, NetworkError, ValidationError } from '../services/apiClient.js';
import { OfflineQueue } from '../services/offlineQueue.js';
import { ContextDetector } from '../services/contextDetector.js';
import { formatSubtarefaItem } from '../services/responseFormatter.js';
import {
  allSettledWithConcurrency,
  DEFAULT_BATCH_CONCURRENCY,
} from '../services/concurrency.js';

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
  subtarefa_id: z
    .union([z.number(), z.array(z.number()).max(500)])
    .optional()
    .describe('ID numérico da subtarefa ou lista de IDs a atualizar.'),
  subtarefa_ids: z
    .array(z.number())
    .max(500)
    .optional()
    .describe('Lista de IDs de subtarefas a serem atualizadas em lote.'),
  titulo: z.string().optional().describe('Novo título da subtarefa.'),
  descricao: z.string().optional().describe('Nova descrição da subtarefa.'),
  status: z.enum(['pendente', 'fazendo', 'concluida', 'cancelada']).optional().describe('Novo status da subtarefa.'),
  data_limite: z.string().optional().describe('Nova data limite YYYY-MM-DD.'),
};

export const ConcluirSubtarefasSchema = {
  subtarefa_ids: z
    .array(z.number())
    .max(500)
    .optional()
    .describe('Lista com os IDs numéricos das subtarefas a serem concluídas.'),
  demanda_id: z
    .number()
    .optional()
    .describe('ID da demanda para concluir todas as subtarefas pendentes vinculadas a ela de uma vez.'),
  status: z
    .enum(['concluida', 'fazendo', 'pendente', 'cancelada'])
    .optional()
    .default('concluida')
    .describe('Status para o qual as subtarefas serão alteradas (default: concluida).'),
};

export function registerSubtarefaTools(
  server: any,
  apiClient: ApiClient,
  queue: OfflineQueue,
  detector?: ContextDetector
) {
  server.tool(
    'criar_subtarefa',
    'Cria uma subtarefa técnica vinculada a uma demanda existente. A operação é bloqueada para projetos não identificados ou explicitamente ignorados. Se offline, armazena na fila local para posterior envio.',
    CriarSubtarefaSchema,
    async (params: any) => {
      const { diretorio_path: targetDir } = params;

      // 1. Exige um projeto identificado e não ignorado
      if (detector) {
        const detected = await detector.detectProject(targetDir || process.cwd());
        if (!detected || detected.ignorado) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'desativado',
                    mcp_ativo: false,
                    mensagem:
                      detected?.motivo_desativacao ||
                      'Operação cancelada: nenhum projeto ativo foi identificado para este diretório.',
                    projeto: detected?.nome,
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
    'Atualiza campos de uma subtarefa (título, descrição, status ou data limite) ou atualiza múltiplos IDs em lote.',
    AtualizarSubtarefaSchema,
    async ({
      subtarefa_id,
      subtarefa_ids,
      ...data
    }: {
      subtarefa_id?: number | number[];
      subtarefa_ids?: number[];
      [key: string]: any;
    }) => {
      try {
        const rawIds = subtarefa_ids || (Array.isArray(subtarefa_id) ? subtarefa_id : [subtarefa_id]);
        const ids = rawIds.filter((id): id is number => typeof id === 'number' && !isNaN(id));

        if (ids.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'erro_validacao',
                    mensagem: 'Informe ao menos um subtarefa_id válido para atualizar.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        if (ids.length === 1) {
          const singleId = ids[0];
          const result = await apiClient.updateSubtarefa(singleId, data);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'sucesso',
                    subtarefa_id: singleId,
                    mensagem: result?.message || 'Subtarefa atualizada com sucesso.',
                    subtarefa: result?.data ? formatSubtarefaItem(result.data) : undefined,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // Múltiplos IDs em lote
        const results = await allSettledWithConcurrency(
          ids,
          DEFAULT_BATCH_CONCURRENCY,
          (id) => apiClient.updateSubtarefa(id, data)
        );

        const sucesso: number[] = [];
        const falhas: Array<{ id: number; erro: string }> = [];

        results.forEach((res, index) => {
          const id = ids[index];
          if (res.status === 'fulfilled') {
            sucesso.push(id);
          } else {
            falhas.push({
              id,
              erro: res.reason?.message || 'Falha ao atualizar subtarefa',
            });
          }
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: falhas.length === 0 ? 'sucesso' : 'parcial',
                  total_solicitadas: ids.length,
                  total_atualizadas: sucesso.length,
                  subtarefas_atualizadas: sucesso,
                  falhas,
                  mensagem: `Atualizadas ${sucesso.length} de ${ids.length} subtarefas com sucesso.`,
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

  server.tool(
    'concluir_subtarefas',
    'Conclui ou altera o status de múltiplas subtarefas em uma única operação (passando uma lista de subtarefa_ids ou o demanda_id para concluir todas as pendentes daquela demanda).',
    ConcluirSubtarefasSchema,
    async ({
      subtarefa_ids,
      demanda_id,
      status = 'concluida',
    }: {
      subtarefa_ids?: number[];
      demanda_id?: number;
      status?: string;
    }) => {
      try {
        if (!subtarefa_ids?.length && !demanda_id) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'erro_validacao',
                    mensagem:
                      'Informe ao menos subtarefa_ids (lista de IDs) ou demanda_id para concluir as subtarefas em lote.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        if (demanda_id && !subtarefa_ids?.length) {
          const result = await apiClient.concluirSubtarefasDaDemanda(demanda_id, status);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: result.falhas.length === 0 ? 'sucesso' : 'parcial',
                    demanda_id,
                    novo_status: status,
                    mensagem: `Foram atualizadas ${result.total_atualizadas} subtarefas da demanda ${demanda_id} para o status '${status}'.`,
                    total_solicitadas: result.total_encontradas,
                    total_atualizadas: result.total_atualizadas,
                    subtarefas_concluidas: result.sucesso,
                    falhas: result.falhas,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const ids = subtarefa_ids || [];
        const result = await apiClient.concluirSubtarefas(ids, status);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: result.falhas.length === 0 ? 'sucesso' : 'parcial',
                  novo_status: status,
                  total_solicitadas: result.total,
                  total_concluidas: result.sucesso.length,
                  mensagem: `Atualizadas com sucesso ${result.sucesso.length} de ${result.total} subtarefas para o status '${status}'.`,
                  subtarefas_concluidas: result.sucesso,
                  falhas: result.falhas,
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
                  mensagem: `Falha ao concluir subtarefas em lote: ${err.message}`,
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
