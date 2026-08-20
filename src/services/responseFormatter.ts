/**
 * Formatadores de resposta JSON de alta densidade semântica e baixo ruído,
 * otimizados para interpretação rápida e economia de contexto para LLMs.
 */

export function cleanDate(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];
    return trimmed;
  }
  return String(val);
}

export function formatDemandaResumo(d: any) {
  if (!d) return d;
  const subtarefasCount = Array.isArray(d.subtarefas)
    ? d.subtarefas.length
    : typeof d.total_subtarefas === 'number'
    ? d.total_subtarefas
    : undefined;

  const responsavelNome =
    typeof d.responsavel === 'string'
      ? d.responsavel
      : d.responsavel?.nome || d.responsavel?.name || undefined;

  const projetoNome =
    typeof d.projeto === 'string'
      ? d.projeto
      : d.projeto?.nome || undefined;

  const sprintNome =
    typeof d.sprint === 'string'
      ? d.sprint
      : d.sprint?.nome || undefined;

  return {
    id: d.id,
    titulo: d.titulo || '',
    status: d.status || 'para_fazer',
    prioridade: d.prioridade || 'Média',
    impacto: d.impacto || undefined,
    projeto_id: d.projeto_id || d.projeto?.id || undefined,
    projeto_nome: projetoNome,
    responsavel: responsavelNome,
    sprint: sprintNome,
    data_inicio: cleanDate(d.data_inicio),
    data_limite: cleanDate(d.data_limite),
    total_subtarefas: subtarefasCount,
  };
}

export function formatSubtarefaItem(s: any) {
  if (!s) return s;
  const responsavelNome =
    s.responsaveis?.[0]?.nome ||
    s.responsaveis?.[0]?.name ||
    s.responsavel?.nome ||
    s.responsavel?.name ||
    (typeof s.responsavel === 'string' ? s.responsavel : undefined);

  return {
    id: s.id,
    demanda_id: s.demanda_id,
    titulo: s.titulo || '',
    descricao: s.descricao ? s.descricao.trim() : undefined,
    status: s.status || 'pendente',
    responsavel: responsavelNome,
    data_limite: cleanDate(s.data_limite),
  };
}

export function formatDemandaDetalhes(raw: any) {
  if (!raw) return raw;
  const d = raw.data || raw;

  const responsavel = d.responsavel
    ? {
        id: d.responsavel.id || d.responsavel_id,
        nome: d.responsavel.nome || d.responsavel.name || '',
        email: d.responsavel.email || '',
        departamento: d.responsavel.departamento || undefined,
      }
    : d.responsavel_id
    ? { id: d.responsavel_id }
    : undefined;

  const projeto = d.projeto
    ? {
        id: d.projeto.id || d.projeto_id,
        nome: d.projeto.nome || '',
      }
    : d.projeto_id
    ? { id: d.projeto_id }
    : undefined;

  const sprint = d.sprint
    ? {
        id: d.sprint.id || d.sprint_id,
        nome: d.sprint.nome || '',
      }
    : d.sprint_id
    ? { id: d.sprint_id }
    : undefined;

  const subtarefas = Array.isArray(d.subtarefas)
    ? d.subtarefas.map(formatSubtarefaItem)
    : [];

  return {
    id: d.id,
    titulo: d.titulo || '',
    descricao: d.descricao || '',
    status: d.status || 'para_fazer',
    prioridade: d.prioridade || 'Média',
    impacto: d.impacto || 'medio',
    classificacao_itil: d.classificacao_itil || undefined,
    tipo_atendimento: d.tipo_atendimento || undefined,
    estimativa_pontos: d.estimativa_pontos !== undefined ? d.estimativa_pontos : undefined,
    solicitante: d.solicitante || undefined,
    projeto,
    sprint,
    responsavel,
    datas: {
      data_inicio: cleanDate(d.data_inicio),
      data_fim: cleanDate(d.data_fim),
      data_limite: cleanDate(d.data_limite),
      criado_em: d.criado_em || cleanDate(d.created_at),
      atualizado_em: cleanDate(d.updated_at),
    },
    total_subtarefas: subtarefas.length,
    subtarefas,
  };
}

export function formatProjetoItem(p: any) {
  if (!p) return p;
  return {
    id: p.id,
    nome: p.nome || '',
    status: p.status || 'ativo',
    departamento: p.departamento || undefined,
    descricao: p.descricao ? p.descricao.trim() : undefined,
  };
}

export function formatSprintItem(s: any) {
  if (!s) return s;
  return {
    id: s.id,
    nome: s.nome || '',
    data_inicio: cleanDate(s.data_inicio),
    data_fim: cleanDate(s.data_fim),
    status: s.status || undefined,
  };
}
