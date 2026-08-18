import { z } from 'zod';

export const StatusDemandaEnum = z.enum([
  'para_fazer',
  'fazendo',
  'em_teste',
  'homologacao',
  'concluida',
  'cancelada',
  'impedimento',
]);
export type StatusDemanda = z.infer<typeof StatusDemandaEnum>;

export const PrioridadeDemandaEnum = z.enum(['Alta', 'Média', 'Baixa']);
export type PrioridadeDemanda = z.infer<typeof PrioridadeDemandaEnum>;

export const ImpactoDemandaEnum = z.enum(['alto', 'medio', 'baixo']);
export type ImpactoDemanda = z.infer<typeof ImpactoDemandaEnum>;

export const ClassificacaoItilEnum = z.enum(['incidente', 'requisicao']);
export type ClassificacaoItil = z.infer<typeof ClassificacaoItilEnum>;

export const TipoAtendimentoEnum = z.enum([
  // Incidentes
  'correcao',
  'correcao_suporte',
  'erro_falha',
  'erro_indisponibilidade',
  'indisponibilidade',
  'duvidas',
  'suporte',
  // Requisições
  'alteracao_cadastro',
  'catalogo_negocio',
  'catalogo_tecnico',
  'desenvolvimento',
  'melhoria',
  'novo_cadastro',
  'publicacao_conteudo',
]);
export type TipoAtendimento = z.infer<typeof TipoAtendimentoEnum>;

export const SubtarefaStatusEnum = z.enum(['pendente', 'fazendo', 'concluida', 'cancelada']);
export type SubtarefaStatus = z.infer<typeof SubtarefaStatusEnum>;

export interface Projeto {
  id: number;
  nome: string;
  status?: string;
  descricao?: string;
  repositorio?: string;
  departamento?: string;
}

export interface Colaborador {
  id: number;
  nome: string;
  email: string;
  departamento?: string;
  ativo?: boolean;
}

export interface Sprint {
  id: number;
  nome: string;
  data_inicio?: string;
  data_fim?: string;
  status?: string;
}

export interface Subtarefa {
  id?: number;
  demanda_id: number | string;
  titulo: string;
  descricao?: string;
  status?: SubtarefaStatus | string;
  data_limite?: string;
  responsaveis?: number[];
  responsavel_id?: number;
  criado_em?: string;
}

export interface Demanda {
  id?: number;
  titulo: string;
  descricao: string;
  projeto_id: number;
  responsavel_id?: number;
  prioridade: PrioridadeDemanda;
  impacto?: ImpactoDemanda;
  status?: StatusDemanda;
  data_inicio?: string;
  data_limite?: string;
  sprint_id?: number;
  classificacao_itil?: ClassificacaoItil;
  tipo_atendimento?: TipoAtendimento | string;
  estimativa_pontos?: number;
  solicitante?: string;
  subtarefas?: Subtarefa[];
  criado_em?: string;
  projeto?: {
    id: number;
    nome: string;
  };
  responsavel?: {
    id: number;
    nome: string;
    email: string;
  };
  sprint?: {
    id: number;
    nome: string;
  };
}

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  cpf?: string;
  created_at?: string;
}

export interface ConfigFile {
  projeto_id?: number;
  nome?: string;
  departamento?: string;
  repositorio?: string;
  ignorado?: boolean;
  desativado?: boolean;
  tipo?: 'prefeitura' | 'externo' | 'interno' | string;
  motivo?: string;
}

export interface ContextoProjeto {
  mcp_ativo: boolean;
  motivo_desativacao?: string;
  projeto?: {
    id?: number;
    nome: string;
    departamento?: string;
    ignorado?: boolean;
  };
  sprint_atual?: {
    id: number;
    nome: string;
  } | null;
  demandas_ativas: Demanda[];
  offline_pendentes?: QueueItem[];
}

export interface QueueItem {
  id?: number;
  client_id: string;
  type: 'demanda' | 'subtarefa';
  payload: Record<string, any>;
  attempts: number;
  last_error?: string | null;
  status: 'pending' | 'failed' | 'synced';
  remote_id?: number | null;
  created_at: string;
  updated_at: string;
}

export interface SyncItemResult {
  id?: number;
  client_id: string;
  type: 'demanda' | 'subtarefa';
  status: 'synced' | 'failed';
  remote_id?: number;
  error?: string;
}

export interface SyncResult {
  total_processed: number;
  succeeded: number;
  failed: number;
  items: SyncItemResult[];
}
