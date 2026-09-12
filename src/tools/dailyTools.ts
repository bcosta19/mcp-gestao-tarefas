import { z } from 'zod';
import { ApiClient, NetworkError, ValidationError } from '../services/apiClient.js';
import { DailyService } from '../services/dailyService.js';

export const DailyItemSchema = z.object({
  descricao: z.string().min(1).describe('Descrição do item da daily.'),
  status: z
    .string()
    .optional()
    .describe('Status do item (bloco Ontem): concluido, em_andamento, cancelado ou pausado.'),
  demanda_id: z.number().nullable().optional().describe('ID da demanda vinculada (opcional).'),
  subtarefa_id: z.number().nullable().optional().describe('ID da subtarefa vinculada (opcional).'),
  afazer_id: z.number().nullable().optional().describe('ID do afazer vinculado (opcional).'),
});

export const RascunhoDailySchema = {
  data: z.string().optional().describe('Data da daily no formato YYYY-MM-DD (default: hoje).'),
  hora_inicio: z
    .string()
    .optional()
    .describe('Início da janela de atividade no formato HH:mm (default: 00:00).'),
  hora_fim: z
    .string()
    .optional()
    .describe('Fim da janela de atividade HH:mm (default: agora; 23:59 para datas passadas).'),
  diretorios: z
    .array(z.string())
    .optional()
    .describe('Diretórios raiz a varrer em busca de repositórios git (default: DAILY_SCAN_DIRS, ~/Work).'),
  incluir_git: z
    .boolean()
    .optional()
    .describe('Se false, monta o rascunho apenas com as sugestões do Gestão de Tarefas.'),
};

export const CriarDailySchema = {
  data: z.string().describe('Data da daily no formato YYYY-MM-DD.'),
  ontem: z.array(DailyItemSchema).optional().describe('Itens realizados/avançados ontem.'),
  hoje: z.array(DailyItemSchema).optional().describe('Itens planejados para hoje.'),
  observacoes: z.array(z.string()).optional().describe('Observações livres do dia.'),
  impedimento_ids: z
    .array(z.number())
    .optional()
    .describe('IDs de impedimentos abertos a vincular à daily.'),
  sprint_id: z.number().optional().describe('ID da sprint da daily.'),
  target_user_id: z
    .number()
    .optional()
    .describe('ID do usuário alvo (apenas admins registram em nome de outro colaborador).'),
};

export function registerDailyTools(
  server: any,
  apiClient: ApiClient,
  dailyService: DailyService
) {
  server.tool(
    'rascunho_daily',
    'Monta um rascunho pré-preenchido da daily: combina as sugestões do Gestão de Tarefas (demandas, subtarefas, afazeres e impedimentos) com os repositórios git que o usuário movimentou na janela de horário informada. Não grava nada — use criar_daily após revisar.',
    RascunhoDailySchema,
    async (params: any) => {
      try {
        const rascunho = await dailyService.gerarRascunho({
          data: params.data,
          horaInicio: params.hora_inicio,
          horaFim: params.hora_fim,
          diretorios: params.diretorios,
          incluirGit: params.incluir_git,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ status: 'sucesso', rascunho }, null, 2),
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
                  mensagem: `Não foi possível montar o rascunho da daily: ${err?.message || err}`,
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
    'criar_daily',
    'Registra a daily no Gestão de Tarefas a partir de um rascunho revisado (ontem, hoje, observações e impedimentos). Uma daily por usuário/data; se já existir, retorna o id e o resumo da existente.',
    CriarDailySchema,
    async (params: any) => {
      try {
        const result = await apiClient.createDaily({
          data: params.data,
          ontem: params.ontem,
          hoje: params.hoje,
          observacoes: params.observacoes,
          impedimento_ids: params.impedimento_ids,
          sprint_id: params.sprint_id,
          target_user_id: params.target_user_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: result.status,
                  daily_id: result.id,
                  resumo: result.resumo,
                  mensagem: result.message,
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
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: 'erro_conexao',
                    mensagem:
                      'A API do Gestão de Tarefas está inacessível; a daily não foi registrada. Tente novamente quando a conexão/VPN estiver disponível.',
                    detalhes: err?.message,
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
                  mensagem: `Falha ao registrar a daily: ${err?.message || err}`,
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
}
