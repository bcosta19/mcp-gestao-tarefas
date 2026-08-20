import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import {
  ApiClient,
  AuthenticationError,
  NetworkError,
  ValidationError,
} from '../src/services/apiClient.js';
import { AppConfig } from '../src/config.js';

describe('ApiClient (HTTP & Error Handling)', () => {
  let server: http.Server;
  let baseUrl: string;
  let testConfig: AppConfig;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const authHeader = req.headers['authorization'];

      // Route: GET /login
      if (req.method === 'GET' && url.pathname === '/login') {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': ['XSRF-TOKEN=initial-xsrf; Path=/', 'gestao_de_tarefas_session=initial-sess; Path=/'],
        });
        res.end('<form><input type="hidden" name="_token" value="mock-csrf-token-123"></form>');
        return;
      }

      // Route: POST /login
      if (req.method === 'POST' && url.pathname === '/login') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          if (body.includes('password=wrong')) {
            res.writeHead(302, { Location: '/login' });
            res.end();
            return;
          }
          res.writeHead(302, {
            Location: '/home',
            'Set-Cookie': ['XSRF-TOKEN=renewed-xsrf; Path=/', 'gestao_de_tarefas_session=renewed-session-123; Path=/'],
          });
          res.end();
        });
        return;
      }

      // Route: GET /session/check
      if (req.method === 'GET' && url.pathname === '/session/check') {
        const cookie = req.headers['cookie'] || '';
        if (cookie.includes('gestao_de_tarefas_session=renewed-session-123') || cookie.includes('valid-session')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ authenticated: true, user_id: 1 }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Unauthenticated.' }));
        }
        return;
      }

      // Route: GET /api/user
      if (req.method === 'GET' && (url.pathname === '/api/user' || url.pathname === '/user')) {
        const cookie = req.headers['cookie'] || '';
        if (authHeader === 'Bearer valid-token' || cookie.includes('gestao_de_tarefas_session=renewed-session-123')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 1,
              name: 'Fulano da Silva',
              email: 'fulano@empresa.gov.br',
            })
          );
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'Unauthenticated.' }));
        }
        return;
      }

      // Route: GET /api/projetos
      if (req.method === 'GET' && (url.pathname === '/api/projetos' || url.pathname === '/projetos')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify([
            { id: 1, nome: 'Gestão de Tarefas', status: 'ativo' },
            { id: 2, nome: 'RH Online', status: 'ativo' },
          ])
        );
        return;
      }

      if (req.method === 'GET' && (url.pathname === '/sprints' || url.pathname === '/api/sprints')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<table><tbody>
          <tr>
            <td data-col="inicio"><div class="sprint-date">01/08/2026</div></td>
            <td data-col="fim"><div class="sprint-date">31/08/2026</div></td>
            <td data-col="status" data-order="ativa"><span class="status-badge status-ativa">Ativa</span></td>
            <td><button data-sprint-nome="Sprint 8.0" data-show-url="/sprints/27"></button></td>
          </tr>
          <tr>
            <td data-col="inicio"><div class="sprint-date">01/07/2026</div></td>
            <td data-col="fim"><div class="sprint-date">31/07/2026</div></td>
            <td data-col="status" data-order="concluida"><span class="status-badge status-concluida">Concluída</span></td>
            <td><button data-sprint-nome="Sprint 7.0" data-show-url="/sprints/26"></button></td>
          </tr>
        </tbody></table>`);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/sprints/27/adicionar-demanda') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Demanda adicionada à sprint com sucesso!' }));
        return;
      }

      // Route: POST /demandas or /api/demandas
      if (req.method === 'POST' && (url.pathname === '/demandas' || url.pathname === '/api/demandas')) {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          if (!parsed.titulo) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                message: 'Dados inválidos.',
                errors: { titulo: ['O título é obrigatório'] },
              })
            );
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              id: 101,
              message: 'Demanda criada com sucesso!',
            })
          );
        });
        return;
      }

      // Route: POST /demandas/:id/subtarefas
      if (req.method === 'POST' && url.pathname.match(/\/demandas\/\d+\/subtarefas/)) {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Subtarefa criada com sucesso',
              subtarefa: {
                id: 55,
                demanda_id: 101,
                titulo: parsed.titulo,
                status: 'pendente',
              },
            })
          );
        });
        return;
      }

      // Default 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found' }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api`;

    testConfig = {
      apiUrl: baseUrl,
      apiToken: 'valid-token',
      offlineQueuePath: '/tmp/test.sqlite',
      requestTimeoutMs: 2000,
    };
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should check connection and authenticate successfully with valid token', async () => {
    const client = new ApiClient(testConfig);
    const result = await client.checkConnection();

    expect(result.connected).toBe(true);
    expect(result.user?.name).toBe('Fulano da Silva');
    expect(result.user?.email).toBe('fulano@empresa.gov.br');
  });

  it('should send an encrypted Laravel XSRF cookie only as X-XSRF-TOKEN', () => {
    const client = new ApiClient({
      ...testConfig,
      apiToken: 'XSRF-TOKEN=encrypted-token%3D; gestao_de_tarefas_session=session-cookie',
    });
    const headers = (client as any).client.defaults.headers;

    expect(headers['X-XSRF-TOKEN']).toBe('encrypted-token=');
    expect(headers['X-CSRF-TOKEN']).toBeUndefined();
  });

  it('should preserve the initial session cookie when a response refreshes cookies', () => {
    const client = new ApiClient({
      ...testConfig,
      apiToken: 'XSRF-TOKEN=encrypted-token%3D; gestao_de_tarefas_session=session-cookie',
    });
    const currentCookies = (client as any).currentSessionCookies();

    expect(currentCookies).toContain('gestao_de_tarefas_session=session-cookie');
  });

  it('should return connected: false when token is invalid', async () => {
    const client = new ApiClient({
      ...testConfig,
      apiToken: 'invalid-token',
    });
    const result = await client.checkConnection();

    expect(result.connected).toBe(false);
    expect(result.error).toContain('Autenticação falhou');
  });

  it('should throw AuthenticationError when calling getUser with invalid token', async () => {
    const client = new ApiClient({
      ...testConfig,
      apiToken: 'invalid-token',
    });

    await expect(client.getUser()).rejects.toThrow(AuthenticationError);
  });

  it('should list projects from the API', async () => {
    const client = new ApiClient(testConfig);
    const projetos = await client.listProjetos();

    expect(projetos).toHaveLength(2);
    expect(projetos[0].nome).toBe('Gestão de Tarefas');
  });

  it('should list sprints from the Gestão HTML page in displayed order', async () => {
    const client = new ApiClient(testConfig);
    const sprints = await client.listSprints();

    expect(sprints).toEqual([
      {
        id: 27,
        nome: 'Sprint 8.0',
        data_inicio: '2026-08-01',
        data_fim: '2026-08-31',
        status: 'ativa',
      },
      {
        id: 26,
        nome: 'Sprint 7.0',
        data_inicio: '2026-07-01',
        data_fim: '2026-07-31',
        status: 'concluida',
      },
    ]);
  });

  it('should associate a demand with a sprint', async () => {
    const client = new ApiClient(testConfig);
    const result = await client.addDemandaToSprint(27, 101);

    expect(result.success).toBe(true);
  });

  it('should create a demand successfully when payload is valid', async () => {
    const client = new ApiClient(testConfig);
    const result = await client.createDemanda({
      projeto_id: 1,
      titulo: 'Implementar interceptor MCP',
      descricao: 'Descrição técnica',
      prioridade: 'Alta',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe(101);
  });

  it('should throw ValidationError (422) with detailed field errors when title is missing', async () => {
    const client = new ApiClient(testConfig);

    try {
      await client.createDemanda({
        projeto_id: 1,
        titulo: '', // missing
        descricao: 'Sem título',
        prioridade: 'Alta',
      });
      expect.fail('Deveria ter lançado ValidationError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.errors).toBeDefined();
      expect(err.errors?.titulo).toContain('O título é obrigatório');
    }
  });

  it('should create a subtask successfully', async () => {
    const client = new ApiClient(testConfig);
    const result = await client.createSubtarefa(101, {
      titulo: 'Criar migration de banco',
      descricao: 'Detalhes da migration',
      data_limite: '2026-08-30',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe(55);
    expect(result.subtarefa?.titulo).toBe('Criar migration de banco');
  });

  it('should throw NetworkError when server is completely unreachable (offline/no VPN)', async () => {
    // Unreachable port
    const offlineClient = new ApiClient({
      ...testConfig,
      apiUrl: 'http://127.0.0.1:54321/api',
      requestTimeoutMs: 300,
    });

    await expect(
      offlineClient.createDemanda({
        projeto_id: 1,
        titulo: 'Teste Offline',
        descricao: 'Offline',
        prioridade: 'Alta',
      })
    ).rejects.toThrow(NetworkError);
  });

  it('should automatically renew session and succeed request when initial token is expired but credentials are provided', async () => {
    const renewingClient = new ApiClient({
      ...testConfig,
      apiToken: 'expired-token-123',
      email: 'fulano@empresa.gov.br',
      password: 'secretpassword',
    });

    const conn = await renewingClient.checkConnection();
    expect(conn.connected).toBe(true);
    expect(conn.user?.id).toBe(1);
  });

  it('should perform explicit login and update session cookies and headers', async () => {
    const client = new ApiClient(testConfig);
    const cookies = await client.login('fulano@empresa.gov.br', 'secretpassword');

    expect(cookies).toContain('renewed-session-123');
    expect(client.isSessionAuth()).toBe(true);
  });
});
