import { z } from 'zod';
import { ApiClient } from '../services/apiClient.js';
import { ContextDetector } from '../services/contextDetector.js';
import { OfflineQueue } from '../services/offlineQueue.js';
import { SprintService } from '../services/sprintService.js';

export const ObterContextoProjetoSchema = {
  diretorio_path: z
    .string()
    .optional()
    .describe('Caminho do diretório do projeto no qual o desenvolvedor está trabalhando (default: diretório atual).'),
};

export const ListarProjetosSchema = {
  status: z
    .string()
    .optional()
    .default('ativo')
    .describe('Filtrar projetos por status (ex: ativo, inativo).'),
};

export function registerContextTools(
  server: any,
  apiClient: ApiClient,
  detector: ContextDetector,
  queue: OfflineQueue,
  sprintService: SprintService
) {
  server.tool(
    'obter_contexto_projeto',
    'Identifica o projeto ativo com base no diretório de trabalho atual (via .gestaotarefas.json ou Git), verificando se o MCP deve operar ou se está desativado para projetos externos ou não identificados.',
    ObterContextoProjetoSchema,
    async ({ diretorio_path }: { diretorio_path?: string }) => {
      const targetDir = diretorio_path || process.cwd();

      // 1. Detect project
      const detected = await detector.detectProject(targetDir);

      if (!detected) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'nao_identificado',
                  mcp_ativo: false,
                  mensagem:
                    'Nenhum projeto foi detectado automaticamente para este diretório. Adicione um arquivo .gestaotarefas.json na raiz do projeto ou verifique os remotos do Git.',
                  diretorio: targetDir,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // 2. Check if project is explicitly ignored
      if (detected.ignorado) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'desativado',
                  mcp_ativo: false,
                  motivo:
                    detected.motivo_desativacao ||
                    'Projeto externo ou pessoal identificado. As operações e eventos de gestão de tarefas estão desativados para este repositório.',
                  projeto: {
                    id: detected.id,
                    nome: detected.nome,
                    departamento: detected.departamento,
                    origem_deteccao: detected.source,
                    ignorado: true,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // 3. Fetch project context from API (or offline fallback)
      let demandasAtivas: any[] = [];
      let sprintAtual: any = null;
      let origemSprint: string | null = null;
      let online = false;

      if (detected.id) {
        try {
          // 3.1 Sprint ativa com persistência local: usa o cache se o intervalo
          // cobrir a data atual (funciona offline) e só consulta a API quando o
          // cache não cobre mais o intervalo.
          const resolvido = await sprintService.resolveActiveSprint();
          const sprint = resolvido.sprint;
          origemSprint = resolvido.fonte;
          online = resolvido.online;

          if (sprint?.id) {
            sprintAtual = {
              id: sprint.id,
              nome: sprint.nome,
              data_inicio: sprint.data_inicio,
              data_fim: sprint.data_fim,
              status: sprint.status,
            };
          }

          // 3.2 Demandas ativas já separadas pela sprint corrente.
          try {
            if (sprint?.id) {
              demandasAtivas = await sprintService.getDemandasDaSprint(detected.id, sprint.id);
              online = true;
            } else {
              demandasAtivas = await apiClient.listDemandas({
                projeto_id: detected.id,
                status: 'fazendo',
              });
              online = true;
            }
          } catch {
            // Offline: sem demandas remotas, mas a sprint do cache é mantida.
            online = false;
          }
        } catch {
          // Falha não relacionada à rede (ex: autenticação): tenta a lista
          // simples de demandas sem filtro de sprint.
          try {
            demandasAtivas = await apiClient.listDemandas({
              projeto_id: detected.id,
              status: 'fazendo',
            });
            online = true;
          } catch {
            online = false;
          }
        }
      }

      // 4. Offline items for this project
      const offlinePending = detected.id
        ? queue.getPendingItems().filter((item) => item.payload.projeto_id === detected.id)
        : [];

      const responseData = {
        status: 'sucesso',
        mcp_ativo: true,
        conectado_intranet: online,
        projeto: {
          id: detected.id,
          nome: detected.nome,
          departamento: detected.departamento,
          origem_deteccao: detected.source,
        },
        sprint_atual: sprintAtual,
        origem_sprint: origemSprint,
        demandas_ativas: demandasAtivas,
        offline_pendentes: offlinePending.map((p) => ({
          client_id: p.client_id,
          tipo: p.type,
          titulo: p.payload.titulo,
        })),
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(responseData, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'listar_projetos',
    'Lista todos os projetos cadastrados no sistema de Gestão de Tarefas.',
    ListarProjetosSchema,
    async ({ status }: { status?: string }) => {
      try {
        const projetos = await apiClient.listProjetos(status || 'ativo');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(projetos, null, 2),
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
                  erro: true,
                  mensagem: `Não foi possível listar projetos: ${err.message}`,
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
