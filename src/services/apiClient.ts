import axios, { AxiosInstance, AxiosError } from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  Colaborador,
  Demanda,
  ImpactoDemanda,
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
import {
  allSettledWithConcurrency,
  DEFAULT_BATCH_CONCURRENCY,
} from './concurrency.js';
import { writeFileAtomic } from './fileStore.js';

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

/**
 * O editor de demandas exige descrição em HTML rich text. Texto simples
 * (sem tags) é escapado e convertido em parágrafos; conteúdo que já
 * contém marcação HTML é mantido como está.
 */
function toRichTextHtml(value: string | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (/<\/?[a-z][\s\S]*>/i.test(value)) return value;
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
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
  private refreshPromise: Promise<string> | null = null;
  private sessionCreateTail: Promise<void> = Promise.resolve();

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

    this.client.interceptors.response.use(
      (response) => {
        if (this.authMode === 'session') {
          const setCookies = response.headers['set-cookie'];
          if (Array.isArray(setCookies) && setCookies.length > 0) {
            this.updateSessionCookies(setCookies);
          }
        }

        // Se uma requisição retornou o formulário de login (redirect HTML), trata como expiração
        if (
          typeof response.data === 'string' &&
          response.data.includes('name="password"') &&
          response.data.includes('name="_token"') &&
          !response.config.url?.includes('/login') &&
          this.hasCredentials() &&
          !(response.config as any)._retry
        ) {
          (response.config as any)._retry = true;
          return this.refreshTokenOrSession().then((newCookies) => {
            response.config.headers['Cookie'] = newCookies;
            const xsrf = getXsrfToken(newCookies);
            if (xsrf) {
              response.config.headers['X-XSRF-TOKEN'] = xsrf;
            }
            return this.client(response.config);
          });
        }

        return response;
      },
      async (error) => {
        const originalRequest = error.config;
        if (!originalRequest || originalRequest._retry) {
          return Promise.reject(error);
        }

        const status = error.response?.status;
        const isAuthFailure = status === 401 || status === 419;

        if (isAuthFailure && this.hasCredentials()) {
          originalRequest._retry = true;
          try {
            const newAuth = await this.refreshTokenOrSession();

            if (this.authMode === 'session') {
              originalRequest.headers['Cookie'] = newAuth;
              const xsrfToken = getXsrfToken(newAuth);
              if (xsrfToken) {
                originalRequest.headers['X-XSRF-TOKEN'] = xsrfToken;
              }
            } else {
              originalRequest.headers['Authorization'] = `Bearer ${newAuth}`;
            }

            return this.client(originalRequest);
          } catch {
            return Promise.reject(error);
          }
        }

        return Promise.reject(error);
      }
    );
  }

  public hasCredentials(): boolean {
    return Boolean(this.email && this.password);
  }

  public isSessionAuth(): boolean {
    return this.authMode === 'session';
  }

  public async refreshTokenOrSession(email?: string, password?: string): Promise<string> {
    const userEmail = email || this.email;
    const userPassword = password || this.password;

    if (!userEmail || !userPassword) {
      throw new Error('E-mail e senha não configurados para renovação automática de sessão.');
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const authValue = await this.login(userEmail, userPassword);
        return authValue;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private persistSessionToken(tokenOrCookie: string): void {
    try {
      const userConfigDir = path.join(os.homedir(), '.gestao-tarefas-mcp');
      const configFilePath = path.join(userConfigDir, 'config.json');
      let existing: any = {};
      if (fs.existsSync(configFilePath)) {
        try {
          existing = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
        } catch {}
      }
      existing.apiUrl = this.baseUrl;
      existing.apiToken = tokenOrCookie;
      if (this.email) existing.email = this.email;
      if (this.password) existing.password = this.password;
      existing.updatedAt = new Date().toISOString();
      if (!fs.existsSync(userConfigDir)) {
        fs.mkdirSync(userConfigDir, { recursive: true });
      }
      writeFileAtomic(configFilePath, JSON.stringify(existing, null, 2));
    } catch {}

    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        const updateEnvKey = (content: string, key: string, value: string): string => {
          const regex = new RegExp(`^${key}=.*$`, 'm');
          if (regex.test(content)) {
            return content.replace(regex, `${key}=${value}`);
          }
          return `${content}\n${key}=${value}`.trim() + '\n';
        };
        envContent = updateEnvKey(envContent, 'GESTAO_TAREFAS_API_TOKEN', tokenOrCookie);
        writeFileAtomic(envPath, envContent);
      }
    } catch {}
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
   * Suporta autenticação automática via API ou Web Session.
   */
  public async login(email?: string, password?: string): Promise<string> {
    const userEmail = email || this.email;
    const userPassword = password || this.password;

    if (!userEmail || !userPassword) {
      throw new Error('E-mail e senha são necessários para autenticar no Gestão de Tarefas.');
    }

    if (email) this.email = email;
    if (password) this.password = password;

    const baseUrl = this.baseUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');

    // 1. Tenta login direto via JSON API caso exista endpoint de token
    const apiEndpoints = [
      `${baseUrl}/api/login`,
      `${baseUrl}/login/api`,
      `${baseUrl}/api/tokens/create`,
      `${baseUrl}/sanctum/token`,
    ];

    for (const endpoint of apiEndpoints) {
      try {
        const response = await axios.post(
          endpoint,
          { email: userEmail, password: userPassword, device_name: 'mcp-agent' },
          {
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            timeout: 7000,
          }
        );
        const data = response.data;
        const token = data?.token || data?.access_token || data?.plainTextToken;
        if (token && typeof token === 'string') {
          this.authMode = 'bearer';
          this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          delete (this.client.defaults.headers as any).common?.['Cookie'];
          delete (this.client.defaults.headers as any).common?.['X-XSRF-TOKEN'];
          this.persistSessionToken(token);
          return token;
        }
      } catch {
        // continua para web login
      }
    }

    // 2. Web Form Login com CSRF
    const loginPage = await axios.get(`${baseUrl}/login`, {
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

    const loginRes = await axios.post(`${baseUrl}/login`, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader,
        Referer: `${baseUrl}/login`,
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
    this.persistSessionToken(combinedCookies);

    return combinedCookies;
  }

  private resolveUrl(pathStr: string): string {
    const cleanPath = pathStr.startsWith('/') ? pathStr : `/${pathStr}`;
    return cleanPath;
  }

  /**
   * Busca o token CSRF da sessão a partir de uma página HTML do app
   * (formulários Laravel embutem um input hidden _token). O
   * DemandaController valida esse token explicitamente no corpo da
   * requisição, então só o cabeçalho X-XSRF-TOKEN não basta para atualizar.
   */
  private async fetchCsrfToken(pagePath: string): Promise<string | undefined> {
    try {
      const response = await this.client.get(this.resolveUrl(pagePath));
      const html = typeof response.data === 'string' ? response.data : '';
      const match =
        html.match(/name=["']_token["']\s+value=["']([^"']+)["']/i) ||
        html.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/i);
      return match?.[1];
    } catch {
      return undefined;
    }
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
                id: Number(authData?.user_id || authData?.id || 1),
                name: authData?.name || 'Usuário autenticado',
                email: authData?.email || '',
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
          id: Number(authData?.user_id || authData?.id || 1),
          name: authData?.name || 'Usuário autenticado',
          email: authData?.email || '',
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
    if (this.authMode !== 'session') {
      return this.createDemandaInternal(data);
    }

    // The legacy web endpoint may omit the created ID. Serialize session
    // creates so two same-title fallback recoveries cannot select one another's
    // record. Bearer/API endpoints can remain concurrent because they return IDs.
    const previous = this.sessionCreateTail;
    let release!: () => void;
    this.sessionCreateTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.createDemandaInternal(data);
    } finally {
      release();
    }
  }

  private async createDemandaInternal(data: Partial<Demanda>): Promise<{ success: boolean; id?: number; message?: string; raw?: any }> {
    const payload: Partial<Demanda> = {
      ...data,
      descricao: toRichTextHtml(data.descricao),
      data_inicio: data.data_inicio || new Date().toISOString().slice(0, 10),
      data_limite: data.data_limite || new Date().toISOString().slice(0, 10),
      impacto: String(data.impacto || '') === 'media' ? 'medio' : data.impacto,
      status: data.status || 'para_fazer',
    };

    try {
      const response = await this.client.post(this.resolveUrl('/demandas'), payload);
      let id = response.data?.id || response.data?.demanda?.id;

      if (!id && payload.projeto_id && payload.titulo) {
        try {
          const after = await this.listDemandas({ projeto_id: payload.projeto_id });
          const created = after
            .filter((demanda) => demanda.titulo === payload.titulo && demanda.id)
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

  public async updateDemanda(demandaId: number, data: Partial<Demanda>): Promise<any> {
    try {
      const payload: Partial<Demanda> & { _token?: string } = {
        ...data,
        descricao: toRichTextHtml(data.descricao),
      };
      if (payload.impacto && String(payload.impacto) === 'media') {
        payload.impacto = 'medio' as ImpactoDemanda;
      }

      // O DemandaController exige o token CSRF no corpo da requisição.
      // Extrai o _token da página de edição da demanda (fallback: índice).
      const token =
        (await this.fetchCsrfToken(`/demandas/${demandaId}/edit`)) ||
        (await this.fetchCsrfToken('/demandas'));
      if (token) {
        payload._token = token;
      }

      const response = await this.client.put(
        this.resolveUrl(`/demandas/${demandaId}`),
        payload
      );
      return response.data;
    } catch (err) {
      this.handleError(err, `atualizar demanda ${demandaId}`);
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

  public async alterarStatusSubtarefa(subtarefaId: number, status: string): Promise<any> {
    try {
      const payload: any = { status };
      const token =
        (await this.fetchCsrfToken(`/subtarefas/${subtarefaId}/edit`)) ||
        (await this.fetchCsrfToken('/demandas'));
      if (token) {
        payload._token = token;
      }
      const response = await this.client.post(
        this.resolveUrl(`/subtarefas/${subtarefaId}/alterar-status`),
        payload
      );
      return response.data;
    } catch (err) {
      this.handleError(err, `alterar status da subtarefa ${subtarefaId}`);
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
      let updateResult: any = null;
      let statusResult: any = null;

      const hasFieldUpdates =
        data.titulo !== undefined ||
        data.descricao !== undefined ||
        data.data_limite !== undefined;

      if (hasFieldUpdates) {
        const updatePayload: any = {};
        if (data.titulo !== undefined) updatePayload.titulo = data.titulo;
        if (data.descricao !== undefined) updatePayload.descricao = data.descricao;
        if (data.data_limite !== undefined) updatePayload.data_limite = data.data_limite;

        const token =
          (await this.fetchCsrfToken(`/subtarefas/${subtarefaId}/edit`)) ||
          (await this.fetchCsrfToken('/demandas'));
        if (token) {
          updatePayload._token = token;
        }

        const response = await this.client.put(
          this.resolveUrl(`/subtarefas/${subtarefaId}`),
          updatePayload
        );
        updateResult = response.data;
      }

      if (data.status !== undefined) {
        statusResult = await this.alterarStatusSubtarefa(subtarefaId, data.status);
      }

      return {
        success: true,
        message: statusResult?.message || updateResult?.message || 'Subtarefa atualizada com sucesso.',
        data: {
          id: subtarefaId,
          ...data,
          ...(updateResult?.subtarefa || updateResult?.data || {}),
          ...(statusResult?.subtarefa || statusResult?.data || {}),
          ...(data.status ? { status: data.status } : {}),
        },
      };
    } catch (err) {
      this.handleError(err, `atualizar subtarefa ${subtarefaId}`);
    }
  }

  public async concluirSubtarefas(
    subtarefaIds: number[],
    status: string = 'concluida'
  ): Promise<{
    total: number;
    sucesso: number[];
    falhas: Array<{ id: number; erro: string }>;
  }> {
    const uniqueIds = [...new Set(subtarefaIds.filter((id) => typeof id === 'number' && !isNaN(id)))];
    const sucesso: number[] = [];
    const falhas: Array<{ id: number; erro: string }> = [];

    // Executa as transições em paralelo
    const results = await allSettledWithConcurrency(
      uniqueIds,
      DEFAULT_BATCH_CONCURRENCY,
      (id) => this.alterarStatusSubtarefa(id, status)
    );

    results.forEach((res, index) => {
      const id = uniqueIds[index];
      if (res.status === 'fulfilled') {
        sucesso.push(id);
      } else {
        falhas.push({
          id,
          erro: res.reason?.message || 'Falha ao alterar status',
        });
      }
    });

    return {
      total: uniqueIds.length,
      sucesso,
      falhas,
    };
  }

  public async concluirSubtarefasDaDemanda(
    demandaId: number,
    status: string = 'concluida'
  ): Promise<{
    demanda_id: number;
    total_encontradas: number;
    total_atualizadas: number;
    sucesso: number[];
    falhas: Array<{ id: number; erro: string }>;
  }> {
    const detalhes = await this.getDemandaDetalhes(demandaId);
    const subList = Array.isArray(detalhes?.subtarefas)
      ? detalhes.subtarefas
      : (detalhes as any)?.data?.subtarefas || [];

    const pendentes = subList
      .filter((s: any) => s.id && s.status !== status)
      .map((s: any) => Number(s.id));

    if (pendentes.length === 0) {
      return {
        demanda_id: demandaId,
        total_encontradas: subList.length,
        total_atualizadas: 0,
        sucesso: [],
        falhas: [],
      };
    }

    const batchRes = await this.concluirSubtarefas(pendentes, status);

    return {
      demanda_id: demandaId,
      total_encontradas: subList.length,
      total_atualizadas: batchRes.sucesso.length,
      sucesso: batchRes.sucesso,
      falhas: batchRes.falhas,
    };
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
