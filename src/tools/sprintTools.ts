import { z } from 'zod';
import { ApiClient } from '../services/apiClient.js';

export const ListarSprintsSchema = {};

export const AssociarDemandaSprintSchema = {
  sprint_id: z.number().describe('ID da sprint de destino.'),
  demanda_id: z.number().describe('ID da demanda que será associada à sprint.'),
};

export function registerSprintTools(server: any, apiClient: ApiClient) {
  server.tool(
    'listar_sprints',
    'Lista as sprints visíveis, em ordem da mais recente para a mais antiga.',
    ListarSprintsSchema,
    async () => {
      try {
        const sprints = await apiClient.listSprints();
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'sucesso', total: sprints.length, sprints }, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'erro', mensagem: `Não foi possível listar sprints: ${err.message}` }, null, 2) }],
        };
      }
    }
  );

  server.tool(
    'associar_demanda_sprint',
    'Associa uma demanda existente a uma sprint. A API rejeita a operação se a demanda já estiver em outra sprint.',
    AssociarDemandaSprintSchema,
    async ({ sprint_id, demanda_id }: { sprint_id: number; demanda_id: number }) => {
      try {
        const result = await apiClient.addDemandaToSprint(sprint_id, demanda_id);
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'sucesso', sprint_id, demanda_id, mensagem: result?.message || 'Demanda associada à sprint.' }, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'erro', sprint_id, demanda_id, mensagem: `Não foi possível associar a demanda à sprint: ${err.message}` }, null, 2) }],
        };
      }
    }
  );
}
