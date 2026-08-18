import { z } from 'zod';
import { ApiClient, NetworkError, ValidationError } from '../services/apiClient.js';
import { OfflineQueue } from '../services/offlineQueue.js';
import { ContextDetector } from '../services/contextDetector.js';
import {
  ClassificacaoItilEnum,
  ImpactoDemandaEnum,
  PrioridadeDemandaEnum,
  StatusDemandaEnum,
} from '../types.js';

export const CriarDemandaSchema = {
  projeto_id: z.number().describe('ID do projeto no Gestão de Tarefas.'),
  titulo: z.string().min(1).max(255).describe('Título claro e objetivo da demanda.'),
  descricao: z.string().min(1).describe('Descrição detalhada da demanda (suporta HTML/Markdown).'),
  prioridade: PrioridadeDemandaEnum.describe('Prioridade da demanda: Alta, Média ou Baixa.'),
  impacto: ImpactoDemandaEnum.optional().default('medio').describe('Impacto: alto, medio ou baixo.'),
  status: StatusDemandaEnum.optional().default('para_fazer').describe('Status inicial da demanda.'),
  responsavel_id: z.number().describe('ID do Colaborador responsável pela demanda. Obrigatório no Gestão de Tarefas.'),
  sprint_id: z.number().optional().describe('ID da Sprint corrente.'),
  data_inicio: z.string().optional().describe('Data de início no formato YYYY-MM-DD (default: data atual).'),
  data_limite: z.string().describe('Data limite no formato YYYY-MM-DD. Obrigatória no Gestão de Tarefas.'),
  classificacao_itil: ClassificacaoItilEnum.optional().describe('Classificação ITIL: incidente ou requisicao.'),
  tipo_atendimento: z.string().optional().describe('Tipo de atendimento ITIL (ex: desenvolvimento, melhoria, correcao).'),
  estimativa_pontos: z.number().optional().describe('Estimativa de esforço em pontos de história.'),
  solicitante: z.string().optional().describe('Nome ou identificação do solicitante da demanda.'),
  diretorio_path: z
    .string()
    .optional()
    .describe('Diretório do projeto a validar para regras de contexto (default: diretório atual do MCP).'),
};

export const ListarDemandasAtivasSchema = {
  projeto_id: z.number().describe('ID do projeto para filtrar as demandas.'),
  responsavel_id: z.number().optional().describe('ID do colaborador para filtrar demandas atribuídas.'),
  status: StatusDemandaEnum.optional().describe('Filtrar por status (ex: para_fazer, fazendo, em_teste, etc.).'),
};

export const ObterDetalhesDemandaSchema = {
  demanda_id: z.number().describe('ID da demanda para consultar detalhes e subtarefas.'),
};

export function registerDemandaTools(
  server: any,
  apiClient: ApiClient,
  queue: OfflineQueue,
  detector?: ContextDetector
) {
  server.tool(
    'criar_demanda',
    'Registra uma nova demanda no sistema de Gestão de Tarefas. Não dispara eventos caso o projeto seja identificado como da Prefeitura ou externo. Se a intranet estiver offline, salva na fila local.',
    CriarDemandaSchema,
    async (params: any) => {
      const { diretorio_path: targetDir, ...demandaParams } = params;

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
                      'Operação cancelada: O projeto atual é da Prefeitura/externo e está desativado para criação de demandas e disparo de eventos.',
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

      const dataInicio = params.data_inicio || new Date().toISOString().split('T')[0];
      const payload = {
        ...demandaParams,
        data_inicio: dataInicio,
      };

      try {
        const result = await apiClient.createDemanda(payload);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'sucesso',
                  modo: 'online',
                  demanda_id: result.id,
                  mensagem: result.message || 'Demanda criada com sucesso na API.',
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
          // Salva na fila offline local
          const queued = queue.enqueue('demanda', payload);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'salvo_offline',
                    modo: 'offline_queue',
                    client_id: queued.client_id,
                    fila_id: queued.id,
                    mensagem:
                      'A API da intranet está inacessível no momento. A demanda foi gravada com segurança na fila offline local e será sincronizada assim que a conexão for restabelecida.',
                    detalhes: {
                      titulo: payload.titulo,
                      projeto_id: payload.projeto_id,
                    },
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
                  mensagem: `Falha ao criar demanda: ${err.message}`,
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
    'listar_demandas_ativas',
    'Lista as demandas abertas ou em andamento de um projeto para análise de contexto e vínculo de subtarefas.',
    ListarDemandasAtivasSchema,
    async (params: any) => {
      try {
        const demandas = await apiClient.listDemandas(params);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'sucesso',
                  total: demandas.length,
                  demandas,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err: any) {
        // Se estiver offline, retorna demandas da fila local para o projeto
        const offlineDemandas = queue
          .getPendingItems()
          .filter((item) => item.type === 'demanda' && item.payload.projeto_id === params.projeto_id);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'offline',
                  aviso: `Não foi possível conectar à API: ${err.message}`,
                  demandas_offline_pendentes: offlineDemandas.map((o) => ({
                    client_id: o.client_id,
                    ...o.payload,
                  })),
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
    'obter_detalhes_demanda',
    'Consulta os detalhes completos de uma demanda específica, incluindo suas subtarefas e responsáveis.',
    ObterDetalhesDemandaSchema,
    async ({ demanda_id }: { demanda_id: number }) => {
      try {
        const detalhes = await apiClient.getDemandaDetalhes(demanda_id);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(detalhes, null, 2),
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
                  mensagem: `Não foi possível obter detalhes da demanda ${demanda_id}: ${err.message}`,
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
