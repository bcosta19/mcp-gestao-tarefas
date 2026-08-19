import { Demanda, Sprint } from '../types.js';
import { ApiClient, NetworkError } from './apiClient.js';
import { OfflineQueue } from './offlineQueue.js';

export type OrigemSprint = 'cache' | 'api' | 'offline';

export interface ResolveSprintResult {
  sprint?: Sprint;
  fonte: OrigemSprint;
  online: boolean;
}

function todayLocalISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isWithinInterval(sprint: Sprint, today: string): boolean {
  if (!sprint.data_inicio || !sprint.data_fim) return false;
  // Datas já normalizadas como YYYY-MM-DD permitem comparação lexicográfica.
  return sprint.data_inicio <= today && today <= sprint.data_fim;
}

/**
 * Resolve a sprint ativa com persistência local:
 * 1. Lê o cache local primeiro. Se houver uma sprint cujo intervalo
 *    (data_inicio <= hoje <= data_fim) cobre a data atual, usa-a sem chamar
 *    a API — funciona mesmo offline.
 * 2. Caso contrário, busca as sprints na API, grava no cache e tenta de novo
 *    pelo intervalo (com preferência por status 'ativa').
 * 3. Se a API estiver fora, devolve a última sprint em cache como fallback.
 */
export class SprintService {
  private apiClient: ApiClient;
  private queue: OfflineQueue;

  constructor(apiClient: ApiClient, queue: OfflineQueue) {
    this.apiClient = apiClient;
    this.queue = queue;
  }

  public async resolveActiveSprint(): Promise<ResolveSprintResult> {
    const today = todayLocalISO();
    const cached = this.queue.getSprints();

    // 1. Cache local válido para o intervalo atual — sem rede.
    const cachedAtiva = cached.find((sprint) => isWithinInterval(sprint, today));
    if (cachedAtiva) {
      return { sprint: cachedAtiva, fonte: 'cache', online: false };
    }

    // 2. Sem cobertura no cache: busca a sprint nova na API e atualiza o cache.
    try {
      const sprints = await this.apiClient.listSprints();
      this.queue.saveSprints(sprints);

      const refresh = this.queue.getSprints();
      const porIntervalo = refresh.find((sprint) => isWithinInterval(sprint, today));
      const porStatus = refresh.find((sprint) => sprint.status === 'ativa');
      const sprint = porIntervalo || porStatus || refresh[0];

      return { sprint, fonte: 'api', online: true };
    } catch (err) {
      // 3. Offline: mantém a última sprint conhecida como fallback.
      if (err instanceof NetworkError) {
        const porStatus = cached.find((sprint) => sprint.status === 'ativa');
        return { sprint: porStatus || cached[0], fonte: 'offline', online: false };
      }
      throw err;
    }
  }

  /**
   * Lista as demandas da sprint ativa já filtradas pelo servidor
   * (Laravel filtra por ?sprint= no index de demandas).
   */
  public async getDemandasDaSprint(
    projetoId: number,
    sprintId: number,
    status: string = 'fazendo'
  ): Promise<Demanda[]> {
    return this.apiClient.listDemandas({
      projeto_id: projetoId,
      status,
      sprint_id: sprintId,
    });
  }
}
