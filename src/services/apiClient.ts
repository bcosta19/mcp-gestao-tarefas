import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  Colaborador,
  Demanda,
  Projeto,
  Sprint,
  Subtarefa,
  UserProfile,
} from '../types.js';
import { AppConfig } from '../config.js';
import {
  getXsrfToken,
  isSessionCookie,
  mergeSetCookies,
  normalizeCookieHeader,
} from './auth.js';

type AuthMode = 'bearer' | 'session';

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractCell(row: string, className: string): string {
  const match = row.match(
    new RegExp(
      `<td\\b[^>]*(?:class=["'][^"']*\\b${className}\\b[^"']*["']|data-col=["']${className}["'])[^>]*>([\\s\\S]*?)<\\/td>`,
      'i'
    )
  );
  return match ? match[1] : '';
}

function extractStatus(cell: string, classPrefix: string): string | undefined {
  const match = cell.match(new RegExp(`${classPrefix}-([^"'\\s]+)`, 'i'));
  return match?.[1];
}

function parseProjectPage(html: string): Projeto[] {
  const projects: Projeto[] = [];
  const rows = html.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi) || [];

  for (const row of rows) {
    const nameCell = extractCell(row, 'nome');
    const nameMatch = nameCell.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    const idMatch = nameCell.match(/ID:\s*(\d+)/i);
    if (!nameMatch || !idMatch) continue;

    const statusCell = extractCell(row, 'status');
    projects.push({
      id: Number(idMatch[1]),
      nome: htmlText(nameMatch[1]),
      descricao: htmlText(extractCell(row, 'descricao')),
      status: extractStatus(statusCell, 'status') || undefined,
    });
  }

  return projects;
}

function parseDemandPage(html: string): { demandas: Demanda[]; hasNextPage: boolean } {
  const demandas: Demanda[] = [];
  const rows = html.match(/<tr\b[^>]*data-demanda-id=["'](\d+)["'][^>]*>([\s\S]*?)<\/tr>/gi) || [];

  for (const row of rows) {
    const idMatch = row.match(/data-demanda-id=["'](\d+)["']/i);
    if (!idMatch) continue;

    const titleCell = extractCell(row, 'td-demanda');
    const titleMatch = titleCell.match(
      /<a\b[^>]*class=["'][^"']*\bdemanda-title\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i
    );
    const deadlineMatch = extractCell(row, 'td-prazo').match(
      /<time\b[^>]*datetime=["']([^"']+)["']/i
    );
    const startMatch = extractCell(row, 'td-inicio').match(
      /<time\b[^>]*datetime=["']([^"']+)["']/i
    );
    const responsibleText = htmlText(extractCell(row, 'td-resp'));
    const projectText = htmlText(extractCell(row, 'td-proj'));
    const sprintText = htmlText(extractCell(row, 'td-sprint'));
    const countMatch = extractCell(row, 'td-sub').match(/count-number[^>]*>(\d+)/i);

    const statusCell = extractCell(row, 'td-status');
    const priorityCell = extractCell(row, 'td-prio');

    demandas.push({
      id: Number(idMatch[1]),
      titulo: htmlText(titleMatch?.[1] || ''),
      descricao: '',
      projeto_id: 0,
      prioridade: htmlText(priorityCell).replace(/^.*?\b(Alta|Média|Baixa)\b.*$/i, '$1') as Demanda['prioridade'],
      status: (extractStatus(statusCell, 'status') || undefined) as Demanda['status'],
      data_limite: deadlineMatch?.[1],
      data_inicio: startMatch?.[1],
      subtarefas: countMatch ? Array.from({ length: Number(countMatch[1]) }, () => ({
        demanda_id: Number(idMatch[1]),
        titulo: '',
      })) : [],
      projeto: projectText && !/^sem projeto$/i.test(projectText)
        ? { id: 0, nome: projectText }
        : undefined,
      responsavel: responsibleText && !/^(não atribuído|nao atribuido)$/i.test(responsibleText)
        ? { id: 0, nome: responsibleText, email: '' }
        : undefined,
      sprint: sprintText && !/^sem sprint$/i.test(sprintText)
        ? { id: 0, nome: sprintText }
        : undefined,
    });
  }

  return {
    demandas,
    hasNextPage: /<a\b[^>]*rel=["']next["'][^>]*>/i.test(html),
  };
}

function parseSprintPage(html: string): Sprint[] {
  const sprints: Sprint[] = [];
  const rows = html.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi) || [];

  for (const row of rows) {
    const showUrl = row.match(/data-show-url=["'][^"']*\/sprints\/(\d+)["']/i);
    if (!showUrl) continue;

    const nomeMatch = row.match(/data-sprint-nome=["']([^"']+)["']/i);
    const inicioCell = extractCell(row, 'inicio');
    const fimCell = extractCell(row, 'fim');
    const statusCell = extractCell(row, 'status');
    // O data-order da sprint fica na tag de abertura do <td>, fora do conteúdo
    // capturado por extractCell — por isso o status é lido da própria tag.
    const statusTag = row.match(/<td\b[^>]*data-col=["']status["'][^>]*>/i)?.[0] || '';
    const statusOrder = statusTag.match(/data-order=["']([^"']+)["']/i);
    // Fallback: a badge usa a classe status-{status}; ignora o status-badge.
    const statusBadge = statusCell.match(/status-(?!badge)([a-z_]+)/i);

    sprints.push({
      id: Number(showUrl[1]),
      nome: htmlText(nomeMatch?.[1] || ''),
      data_inicio: parseSprintDate(htmlText(inicioCell)),
      data_fim: parseSprintDate(htmlText(fimCell)),
      status: statusOrder?.[1] || statusBadge?.[1] || undefined,
    });
  }

  return sprints;
}

function parseSprintDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return undefined;
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends Error {
  public errors?: Record<string, string[]>;

  constructor(message: string, errors?: Record<string, string[]>) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

export class ApiError extends Error {
  public statusCode?: number;
  public responseData?: any;

  constructor(message: string, statusCode?: number, responseData?: any) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.responseData = responseData;
  }
}

export class ApiClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private authMode: AuthMode;

  private email?: string;
  private password?: string;

  constructor(config: AppConfig) {
    // A aplicação Laravel expõe as operações do MCP nas rotas web raiz.
    // Remover um /api acidental da configuração evita gerar /api/demandas,
    // rota que não existe nessa aplicação.
    this.baseUrl = config.apiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');
    this.email = config.email;
    this.password = config.password;
    this.authMode = config.apiToken && !isSessionCookie(config.apiToken) ? 'bearer' : 'session';

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (config.apiToken) {
      if (this.authMode === 'session') {
        const cookieHeader = normalizeCookieHeader(config.apiToken);
        headers['Cookie'] = cookieHeader;
        const xsrfToken = getXsrfToken(cookieHeader);
        if (xsrfToken) {
          // O cookie XSRF-TOKEN é criptografado pelo Laravel. O middleware
          // PreventRequestForgery consegue descriptografá-lo quando recebe o
          // valor no cabeçalho X-XSRF-TOKEN. Não o envie também como
          // X-CSRF-TOKEN: esse cabeçalho é reservado ao token interno da
          // sessão e tem precedência no Laravel.
          headers['X-XSRF-TOKEN'] = xsrfToken;
        }
      } else {
        headers['Authorization'] = `Bearer ${config.apiToken}`;
      }
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.requestTimeoutMs,
      headers,
    });

    this.client.interceptors.response.use((response) => {
      if (this.authMode === 'session') {
        const setCookies = response.headers['set-cookie'];
        if (Array.isArray(setCookies) && setCookies.length > 0) {
          this.updateSessionCookies(setCookies);
        }
      }
      return response;
    });
  }

  private currentSessionCookies(): string {
    // Axios mantém os cabeçalhos fornecidos na criação da instância no nível
    // superior de defaults.headers, enquanto os cookies recebidos depois do
    // login ficam em defaults.headers.common.
    const headers = this.client.defaults.headers as any;
    const cookie = headers.common?.['Cookie'] ?? headers['Cookie'];
    return typeof cookie === 'string' ? cookie : '';
  }

  private setSessionCookie(cookieHeader: string): void {
    const normalized = normalizeCookieHeader(cookieHeader);
    if (!normalized) return;

    this.authMode = 'session';
    const headers = this.client.defaults.headers as any;
    headers.common['Cookie'] = normalized;
    delete headers['Cookie'];

    const xsrfToken = getXsrfToken(normalized);
    if (xsrfToken) {
      headers.common['X-XSRF-TOKEN'] = xsrfToken;
      delete headers['X-XSRF-TOKEN'];
      delete headers.common['X-CSRF-TOKEN'];
      delete headers['X-CSRF-TOKEN'];
    }
  }

  private updateSessionCookies(setCookies: string[]): void {
    const merged = mergeSetCookies(this.currentSessionCookies(), setCookies);
    if (!merged) return;

    this.setSessionCookie(merged);
  }

  private authEndpoint(): string {
    return this.authMode === 'session' ? '/session/check' : '/api/user';
  }

  private async requestAuthenticatedUser(): Promise<any> {
    try {
      const response = await this.client.get(this.resolveUrl(this.authEndpoint()));
      return response.data;
    } catch (err) {
      this.handleError(err, 'validar autenticação');
    }
  }

  /**
   * Efetua login no formulário web existente e guarda a sessão Laravel.
   * A aplicação atual não possui endpoint público de login Sanctum.
   */
  public async login(email?: string, password?: string): Promise<string> {
    const userEmail = email || this.email;
    const userPassword = password || this.password;

    if (!userEmail || !userPassword) {
      throw new Error('E-mail e senha são necessários para autenticar no Gestão de Tarefas.');
    }

    const webBaseUrl = this.baseUrl.replace(/\/api\/?$/, '');

    // 1. GET /login para extrair CSRF token e cookies iniciais
    const loginPage = await axios.get(`${webBaseUrl}/login`, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 10000,
    });

    const initialCookies = loginPage.headers['set-cookie'] || [];
    const html = String(loginPage.data);
    const csrfMatch =
      html.match(/name=["']_token["']\s+value=["']([^"']+)["']/i) ||
      html.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/i);
    const csrfToken = csrfMatch ? csrfMatch[1] : '';

    if (!csrfToken) {
      throw new Error('Não foi possível obter o token CSRF da página de login.');
    }

    const cookieHeader = normalizeCookieHeader(initialCookies.map((c) => c.split(';')[0]).join('; '));
    const params = new URLSearchParams();
    params.append('_token', csrfToken);
    params.append('email', userEmail);
    params.append('password', userPassword);

    const loginRes = await axios.post(`${webBaseUrl}/login`, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader,
        Referer: `${webBaseUrl}/login`,
      },
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
      timeout: 10000,
    });

    const postCookies = loginRes.headers['set-cookie'] || [];
    const combinedCookies = mergeSetCookies(
      initialCookies.map((c) => c.split(';', 1)[0]).join('; '),
      postCookies
    );

    const redirectLoc = loginRes.headers['location'] || '';
    if (redirectLoc.includes('/login') && !redirectLoc.includes('/home')) {
      throw new Error('Credenciais inválidas: e-mail ou senha incorretos.');
    }

    this.setSessionCookie(combinedCookies);

    return combinedCookies;
  }

  private resolveUrl(pathStr: string): string {
    const cleanPath = pathStr.startsWith('/') ? pathStr : `/${pathStr}`;
    return cleanPath;
  }

  private handleError(error: unknown, contextMsg: string): never {
    if (axios.isAxiosError(error)) {
      const axiosErr = error as AxiosError<any>;

      // Network / Connection / Timeout errors
      if (
        !axiosErr.response ||
        axiosErr.code === 'ECONNREFUSED' ||
        axiosErr.code === 'ENOTFOUND' ||
        axiosErr.code === 'ETIMEDOUT' ||
        axiosErr.code === 'ECONNABORTED' ||
        axiosErr.code === 'ERR_NETWORK'
      ) {
        throw new NetworkError(
          `Falha de conexão com a API (${contextMsg}): ${axiosErr.message}. Verifique a conexão com a VPN ou intranet.`
        );
      }

      const status = axiosErr.response.status;
      const data = axiosErr.response.data;

      if (status === 401 || status === 403) {
        throw new AuthenticationError(
          `Erro de autenticação (${status}): Usuário não autenticado ou sessão expirada.`
        );
      }

      if (status === 422) {
        const message = data?.message || 'Dados inválidos. Verifique os campos fornecidos.';
        throw new ValidationError(message, data?.errors);
      }

      const message = data?.message || axiosErr.message || `Erro na API (${status})`;
      throw new ApiError(message, status, data);
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`Erro desconhecido ao ${contextMsg}: ${String(error)}`);
  }

  public async checkConnection(): Promise<{
    connected: boolean;
    user?: UserProfile;
    error?: string;
  }> {
    try {
      let authData;
      try {
        authData = await this.requestAuthenticatedUser();
      } catch (err: any) {
        // Se deu 401 e temos email/password, tenta autenticar automaticamente no /login
        if (err instanceof AuthenticationError && this.email && this.password) {
          await this.login();
          authData = await this.requestAuthenticatedUser();
        } else {
          throw err;
        }
      }

      return {
        connected: true,
        user:
          this.authMode === 'session'
            ? {
                id: Number(authData?.user_id),
                name: 'Usuário autenticado',
                email: '',
              }
            : authData,
      };
    } catch (err: any) {
      if (
        err instanceof AuthenticationError ||
        (err.isAxiosError && (err.response?.status === 401 || err.response?.status === 403))
      ) {
        return {
          connected: false,
          error: 'Autenticação falhou: Credenciais inválidas ou sessão expirada.',
        };
      }
      return {
        connected: false,
        error: err.message || 'Não foi possível conectar à API / Servidor desconectado.',
      };
    }
  }

  public async getUser(): Promise<UserProfile> {
    try {
      const authData = await this.requestAuthenticatedUser();
      if (this.authMode === 'session') {
        return {
          id: Number(authData?.user_id),
          name: 'Usuário autenticado',
          email: '',
        };
      }
      return authData;
    } catch (err) {
      this.handleError(err, 'obter usuário autenticado');
    }
  }

  public async listProjetos(status: string = 'ativo'): Promise<Projeto[]> {
    try {
      // A aplicação atual renderiza a lista de projetos em /projetos, sem uma
      // rota JSON correspondente. O parser fica restrito às marcações estáveis
      // da tabela para não depender do texto visual da página.
      const response = await this.client.get(this.resolveUrl('/projetos'), {
        params: { status },
      });
      if (Array.isArray(response.data)) return response.data;
      if (Array.isArray(response.data?.data)) return response.data.data;
      if (typeof response.data === 'string') return parseProjectPage(response.data);
      return [];
    } catch (err) {
      this.handleError(err, 'listar projetos');
    }
  }

  public async listColaboradores(): Promise<Colaborador[]> {
    try {
      // Tenta rota /colaboradores/listar/json ou /api/colaboradores
      let response;
      try {
        response = await this.client.get(this.resolveUrl('/colaboradores/listar/json'));
      } catch (err) {
        response = await this.client.get(this.resolveUrl('/api/colaboradores'));
      }
      return Array.isArray(response.data) ? response.data : response.data.data || [];
    } catch (err) {
      this.handleError(err, 'listar colaboradores');
    }
  }

  public async listDemandas(filters?: {
    projeto_id?: number;
    responsavel_id?: number;
    status?: string;
    sprint_id?: number;
  }): Promise<Demanda[]> {
    try {
      const params = {
        projeto: filters?.projeto_id,
        responsavel: filters?.responsavel_id,
        status: filters?.status,
        sprint: filters?.sprint_id,
      };
      const allDemandas: Demanda[] = [];
      let page = 1;
      let hasNextPage = true;

      while (hasNextPage && page <= 100) {
        const response = await this.client.get(this.resolveUrl('/demandas'), {
          params: { ...params, page },
        });

        if (Array.isArray(response.data)) return response.data;
        if (Array.isArray(response.data?.data)) return response.data.data;
        if (typeof response.data !== 'string') return allDemandas;

        const parsed = parseDemandPage(response.data);
        allDemandas.push(...parsed.demandas);
        hasNextPage = parsed.hasNextPage;
        page += 1;
      }

      return [...new Map(allDemandas.map((demanda) => [demanda.id, demanda])).values()];
    } catch (err) {
      this.handleError(err, 'listar demandas');
    }
  }

  public async getDemandaDetalhes(demandaId: number): Promise<Demanda> {
    try {
      const response = await this.client.get(this.resolveUrl(`/demandas/${demandaId}/detalhes`));
      return response.data;
    } catch (err) {
      this.handleError(err, `obter detalhes da demanda ${demandaId}`);
    }
  }

  public async listSprints(): Promise<Sprint[]> {
    try {
      const response = await this.client.get(this.resolveUrl('/sprints'));
      if (Array.isArray(response.data)) return response.data;
      if (Array.isArray(response.data?.data)) return response.data.data;
      if (typeof response.data === 'string') return parseSprintPage(response.data);
      return [];
    } catch (err) {
      this.handleError(err, 'listar sprints');
    }
  }

  public async addDemandaToSprint(sprintId: number, demandaId: number): Promise<any> {
    try {
      const response = await this.client.post(
        this.resolveUrl(`/sprints/${sprintId}/adicionar-demanda`),
        { demanda_id: demandaId }
      );
      return response.data;
    } catch (err) {
      this.handleError(err, `associar demanda ${demandaId} à sprint ${sprintId}`);
    }
  }

  public async createDemanda(data: Partial<Demanda>): Promise<{ success: boolean; id?: number; message?: string; raw?: any }> {
    const payload: Partial<Demanda> = {
      ...data,
      data_inicio: data.data_inicio || new Date().toISOString().slice(0, 10),
      data_limite: data.data_limite || new Date().toISOString().slice(0, 10),
      impacto: String(data.impacto || '') === 'media' ? 'medio' : data.impacto,
      status: data.status || 'para_fazer',
    };

    // O controller web atual retorna sucesso, mas não devolve o ID criado.
    // Guardamos os IDs anteriores para recuperar o novo registro sem alterar
    // a aplicação Laravel nem assumir que títulos são únicos.
    let previousIds = new Set<number>();
    if (this.authMode === 'session' && payload.projeto_id) {
      try {
        const previous = await this.listDemandas({ projeto_id: payload.projeto_id });
        previousIds = new Set(previous.flatMap((demanda) => (demanda.id ? [demanda.id] : [])));
      } catch {
        // A criação ainda pode prosseguir; o ID será retornado quando a API o fornecer.
      }
    }

    try {
      const response = await this.client.post(this.resolveUrl('/demandas'), payload);
      let id = response.data?.id || response.data?.demanda?.id;

      if (!id && payload.projeto_id && payload.titulo) {
        try {
          const after = await this.listDemandas({ projeto_id: payload.projeto_id });
          const created = after
            .filter((demanda) => demanda.titulo === payload.titulo && demanda.id && !previousIds.has(demanda.id))
            .sort((a, b) => Number(b.id) - Number(a.id))[0];
          id = created?.id;
        } catch {
          // Não transforma uma criação confirmada em erro apenas porque a
          // leitura posterior do ID não foi possível.
        }
      }

      return {
        success: true,
        id,
        message: response.data?.message || 'Demanda criada com sucesso!',
        raw: response.data,
      };
    } catch (err) {
      this.handleError(err, 'criar demanda');
    }
  }

  public async createDemandaRapidaSprint(
    sprintId: number,
    data: {
      titulo: string;
      descricao?: string;
      projeto_id: number;
      responsavel_id?: number;
      prioridade?: string;
      data_limite?: string;
      estimativa_pontos?: number;
      subtarefas?: string[];
    }
  ): Promise<any> {
    try {
      const response = await this.client.post(
        this.resolveUrl(`/sprints/${sprintId}/criar-demanda-rapida`),
        data
      );
      return response.data;
    } catch (err) {
      this.handleError(err, `criar demanda rápida na sprint ${sprintId}`);
    }
  }

  public async atualizarStatusDemanda(demandaId: number, status: string): Promise<any> {
    try {
      const response = await this.client.post(
        this.resolveUrl(`/demandas/${demandaId}/atualizar-status`),
        { status }
      );
      return response.data;
    } catch (err) {
      this.handleError(err, `atualizar status da demanda ${demandaId}`);
    }
  }

  public async createSubtarefa(
    demandaId: number,
    data: {
      titulo: string;
      descricao?: string;
      data_limite?: string;
      responsaveis?: number[];
      responsavel_id?: number;
    }
  ): Promise<{ success: boolean; id?: number; subtarefa?: Subtarefa; message?: string }> {
    try {
      const payload = {
        titulo: data.titulo,
        descricao: data.descricao,
        data_limite: data.data_limite,
        responsaveis: data.responsaveis || (data.responsavel_id ? [data.responsavel_id] : []),
      };

      const response = await this.client.post(
        this.resolveUrl(`/demandas/${demandaId}/subtarefas`),
        payload
      );

      return {
        success: true,
        id: response.data?.subtarefa?.id || response.data?.id,
        subtarefa: response.data?.subtarefa,
        message: response.data?.message || 'Subtarefa criada com sucesso',
      };
    } catch (err) {
      this.handleError(err, `criar subtarefa na demanda ${demandaId}`);
    }
  }

  public async updateSubtarefa(
    subtarefaId: number,
    data: {
      titulo?: string;
      descricao?: string;
      status?: string;
      data_limite?: string;
    }
  ): Promise<any> {
    try {
      const response = await this.client.put(
        this.resolveUrl(`/subtarefas/${subtarefaId}`),
        data
      );
      return response.data;
    } catch (err) {
      this.handleError(err, `atualizar subtarefa ${subtarefaId}`);
    }
  }

  public async deleteSubtarefa(subtarefaId: number): Promise<any> {
    try {
      const response = await this.client.delete(
        this.resolveUrl(`/subtarefas/${subtarefaId}`)
      );
      return response.data;
    } catch (err) {
      this.handleError(err, `excluir subtarefa ${subtarefaId}`);
    }
  }
}
