import { describe, it, expect } from 'vitest';
import {
  cleanDate,
  formatDemandaResumo,
  formatDemandaDetalhes,
  formatSubtarefaItem,
  formatProjetoItem,
  formatSprintItem,
} from '../src/services/responseFormatter.js';

describe('responseFormatter', () => {
  describe('cleanDate', () => {
    it('extracts YYYY-MM-DD from ISO datetime string', () => {
      expect(cleanDate('2026-08-11T03:00:00.000000Z')).toBe('2026-08-11');
      expect(cleanDate('2026-08-25')).toBe('2026-08-25');
    });

    it('returns null for empty or null dates', () => {
      expect(cleanDate(null)).toBeNull();
      expect(cleanDate(undefined)).toBeNull();
      expect(cleanDate('')).toBeNull();
    });
  });

  describe('formatDemandaResumo', () => {
    it('normalizes demand summary fields and counts subtasks', () => {
      const input = {
        id: 104,
        titulo: 'Integração SSO',
        status: 'fazendo',
        prioridade: 'Alta',
        impacto: 'alto',
        projeto_id: 130,
        projeto: { id: 130, nome: 'Gestão de Tarefas' },
        responsavel: { id: 91, nome: 'Bruno Costa' },
        sprint: { id: 27, nome: 'Sprint 8.0' },
        data_inicio: '2026-08-10T00:00:00.000000Z',
        data_limite: '2026-08-25T00:00:00.000000Z',
        subtarefas: [{ id: 1 }, { id: 2 }],
      };

      const result = formatDemandaResumo(input);
      expect(result).toEqual({
        id: 104,
        titulo: 'Integração SSO',
        status: 'fazendo',
        prioridade: 'Alta',
        impacto: 'alto',
        projeto_id: 130,
        projeto_nome: 'Gestão de Tarefas',
        responsavel: 'Bruno Costa',
        sprint: 'Sprint 8.0',
        data_inicio: '2026-08-10',
        data_limite: '2026-08-25',
        total_subtarefas: 2,
      });
    });
  });

  describe('formatDemandaDetalhes', () => {
    it('strips redundant noise and formats details cleanly', () => {
      const rawApiPayload = {
        success: true,
        data: {
          id: 10065,
          titulo: 'fix: ajustes nas telas',
          descricao: '<p>Descricao</p>',
          status: 'em_teste',
          prioridade: 'média',
          impacto: 'medio',
          classificacao_itil: 'requisicao',
          tipo_atendimento: 'desenvolvimento',
          estimativa_pontos: 2,
          solicitante: 'Bruno Costa',
          projeto_id: 130,
          sprint_id: 27,
          responsavel_id: 91,
          data_inicio: '2026-08-11T03:00:00.000000Z',
          data_fim: null,
          data_limite: '2026-08-13T03:00:00.000000Z',
          created_at: '2026-08-11T18:00:23.000000Z',
          updated_at: '2026-08-19T19:23:59.000000Z',
          criado_em: '11/08/2026 15:00',
          responsavel: {
            id: 91,
            nome: 'Bruno Costa',
            cpf: '111.222.333-44',
            email: 'brpassos19@gmail.com',
            departamento: 'TI',
            photo: 'fotos/user.jpg',
            user: { id: 35, email: 'brpassos19@gmail.com' },
          },
          projeto: {
            id: 130,
            nome: 'Gestão De Tarefas',
            itens_producao: ['10.135.16.159'],
          },
          sprint: {
            id: 27,
            nome: 'Sprint 8.0',
          },
          subtarefas: [
            {
              id: 1596,
              demanda_id: 10065,
              titulo: 'Subtarefa 1',
              descricao: 'Descricao detalhada',
              status: 'concluida',
              data_limite: '2026-08-13T00:00:00.000000Z',
              responsaveis: [{ nome: 'Bruno Costa' }],
            },
          ],
        },
      };

      const result = formatDemandaDetalhes(rawApiPayload);
      expect(result.id).toBe(10065);
      expect(result.titulo).toBe('fix: ajustes nas telas');
      expect(result.projeto).toEqual({ id: 130, nome: 'Gestão De Tarefas' });
      expect(result.sprint).toEqual({ id: 27, nome: 'Sprint 8.0' });
      expect(result.responsavel).toEqual({
        id: 91,
        nome: 'Bruno Costa',
        email: 'brpassos19@gmail.com',
        departamento: 'TI',
      });
      expect(result.datas).toEqual({
        data_inicio: '2026-08-11',
        data_fim: null,
        data_limite: '2026-08-13',
        criado_em: '11/08/2026 15:00',
        atualizado_em: '2026-08-19',
      });
      expect(result.total_subtarefas).toBe(1);
      expect(result.subtarefas[0]).toEqual({
        id: 1596,
        demanda_id: 10065,
        titulo: 'Subtarefa 1',
        descricao: 'Descricao detalhada',
        status: 'concluida',
        responsavel: 'Bruno Costa',
        data_limite: '2026-08-13',
      });
    });
  });

  describe('formatProjetoItem and formatSprintItem', () => {
    it('formats project item cleanly', () => {
      const p = formatProjetoItem({
        id: 130,
        nome: 'Gestão De Tarefas',
        status: 'ativo',
        departamento: 'TI',
        descricao: 'Sistema interno',
        itens_producao: ['10.0.0.1'],
      });
      expect(p).toEqual({
        id: 130,
        nome: 'Gestão De Tarefas',
        status: 'ativo',
        departamento: 'TI',
        descricao: 'Sistema interno',
      });
    });

    it('formats sprint item cleanly', () => {
      const s = formatSprintItem({
        id: 27,
        nome: 'Sprint 8.0',
        data_inicio: '2026-08-10T00:00:00Z',
        data_fim: '2026-08-25T00:00:00Z',
        status: 'planejamento',
      });
      expect(s).toEqual({
        id: 27,
        nome: 'Sprint 8.0',
        data_inicio: '2026-08-10',
        data_fim: '2026-08-25',
        status: 'planejamento',
      });
    });
  });
});
