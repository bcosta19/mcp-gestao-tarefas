import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createServer } from '../src/server.js';
import { AppConfig } from '../src/config.js';
import { registerContextTools } from '../src/tools/contextTools.js';

describe('MCP Tools Full Specification & Behavior', () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpDir: string;
  let testConfig: AppConfig;
  let mockRequests: Array<{ method: string; url: string; body?: any }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      let body = '';

      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let parsedBody;
        try {
          parsedBody = body ? JSON.parse(body) : undefined;
        } catch {
          parsedBody = body;
        }
        mockRequests.push({
          method: req.method || 'GET',
          url: url.pathname,
          search: url.search,
          body: parsedBody,
        });

        // Route: GET /api/user or /session/check
        if (
          req.method === 'GET' &&
          (url.pathname === '/api/user' ||
            url.pathname === '/user' ||
            url.pathname === '/session/check')
        ) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 1,
              user_id: 1,
              name: 'Fulano da Silva',
              email: 'fulano@empresa.gov.br',
              cpf: '000.000.000-00',
              created_at: '2026-01-10T12:00:00.000000Z',
            })
          );
          return;
        }

        // Route: GET /api/projetos
        if (req.method === 'GET' && (url.pathname === '/api/projetos' || url.pathname === '/projetos')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify([
              {
                id: 1,
                nome: 'Gestão de Tarefas',
                status: 'ativo',
                descricao: 'Sistema interno de gestão de demandas',
              },
            ])
          );
          return;
        }

        // Route: GET /demandas
        if (req.method === 'GET' && (url.pathname === '/demandas' || url.pathname === '/api/demandas')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify([
              {
                id: 104,
                titulo: 'Integração Microsoft OAuth',
                status: 'fazendo',
                prioridade: 'Alta',
                projeto_id: 1,
              },
            ])
          );
          return;
        }

        // Route: GET /sprints
        if (req.method === 'GET' && (url.pathname === '/sprints' || url.pathname === '/api/sprints')) {
          const today = new Date();
          const iso = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
          };
          const past = new Date(today);
          past.setDate(past.getDate() - 15);
          const future = new Date(today);
          future.setDate(future.getDate() + 15);
          const br = (i: string) => {
            const [y, m, d] = i.split('-');
            return `${d}/${m}/${y}`;
          };
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<table><tbody>
            <tr>
              <td data-col="inicio"><div class="sprint-date">${br(iso(past))}</div></td>
              <td data-col="fim"><div class="sprint-date">${br(iso(future))}</div></td>
              <td data-col="status" data-order="ativa"><span class="status-badge status-ativa">Ativa</span></td>
              <td><button data-sprint-nome="Sprint 9.0" data-show-url="/sprints/28"></button></td>
            </tr>
          </tbody></table>`);
          return;
        }

        // Route: GET /demandas/104/detalhes
        if (req.method === 'GET' && url.pathname.match(/\/demandas\/\d+\/detalhes/)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              id: 104,
              titulo: 'Integração Microsoft OAuth',
              descricao: 'Configuração de login institucional',
              status: 'fazendo',
              prioridade: 'Alta',
              subtarefas: [
                { id: 12, titulo: 'Configurar App no Azure AD', status: 'concluida' },
                { id: 13, titulo: 'Tratar erro 401 no callback', status: 'pendente' },
              ],
            })
          );
          return;
        }

        // Route: POST /demandas
        if (req.method === 'POST' && (url.pathname === '/demandas' || url.pathname === '/api/demandas')) {
          if (!parsedBody?.titulo) {
            res.writeHead(422, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
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
              id: 200,
              message: 'Demanda criada com sucesso!',
              redirect: 'http://.../demandas',
            })
          );
          return;
        }

        // Route: POST /demandas/:id/subtarefas
        if (req.method === 'POST' && url.pathname.match(/\/demandas\/\d+\/subtarefas/)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Subtarefa criada com sucesso',
              subtarefa: {
                id: 45,
                demanda_id: 104,
                titulo: parsedBody?.titulo,
                status: 'pendente',
              },
            })
          );
          return;
        }

        // Route: POST /subtarefas/:id/alterar-status
        if (req.method === 'POST' && url.pathname.match(/\/subtarefas\/\d+\/alterar-status/)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Status alterado com sucesso',
              status: parsedBody?.status || 'concluida',
            })
          );
          return;
        }

        // Route: PUT /subtarefas/:id
        if (req.method === 'PUT' && url.pathname.match(/\/subtarefas\/\d+/)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Subtarefa atualizada com sucesso',
            })
          );
          return;
        }

        // Route: GET /demandas/:id/edit (página de edição com _token CSRF)
        if (req.method === 'GET' && url.pathname.match(/\/demandas\/\d+\/edit/)) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<form method="post"><input type="hidden" name="_token" value="csrf-token-123" /></form>'
          );
          return;
        }

        // Route: PUT /demandas/:id
        if (req.method === 'PUT' && url.pathname.match(/\/demandas\/\d+/)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              message: 'Demanda atualizada com sucesso',
            })
          );
          return;
        }

        // Route: GET /login
        if (req.method === 'GET' && url.pathname === '/login') {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Set-Cookie': ['XSRF-TOKEN=initial-xsrf; Path=/', 'gestao_de_tarefas_session=initial-sess; Path=/'],
          });
          res.end('<form><input type="hidden" name="_token" value="csrf-token-123"></form>');
          return;
        }

        // Route: POST /login
        if (req.method === 'POST' && url.pathname === '/login') {
          res.writeHead(302, {
            Location: '/home',
            'Set-Cookie': ['XSRF-TOKEN=renewed-xsrf; Path=/', 'gestao_de_tarefas_session=renewed-sess; Path=/'],
          });
          res.end();
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Not found' }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-full-test-'));
    testConfig = {
      apiUrl: baseUrl,
      apiToken: 'sanctum-bearer-token',
      offlineQueuePath: path.join(tmpDir, 'queue.sqlite'),
      requestTimeoutMs: 2000,
    };
    mockRequests = [];
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Tool 1: obter_contexto_projeto resolves project context and active demands', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.gestaotarefas.json'),
      JSON.stringify({
        projeto_id: 1,
        nome: 'Gestão de Tarefas',
        departamento: 'TI',
      })
    );

    const { detector, apiClient, queue } = createServer(testConfig);
    const detected = await detector.detectProject(tmpDir);
    expect(detected?.id).toBe(1);
    expect(detected?.nome).toBe('Gestão de Tarefas');

    const activeDemands = await apiClient.listDemandas({ projeto_id: 1, status: 'fazendo' });
    expect(activeDemands).toHaveLength(1);
    expect(activeDemands[0].titulo).toBe('Integração Microsoft OAuth');
    queue.close();
  });

  it('obter_contexto_projeto resolve a sprint ativa e separa as demandas pela sprint', async () => {
    fs.writeFileSync(
      path.join(tmpDir, '.gestaotarefas.json'),
      JSON.stringify({
        projeto_id: 1,
        nome: 'Gestão de Tarefas',
        departamento: 'TI',
      })
    );

    const { apiClient, detector, queue, sprintService } = createServer(testConfig);
    const handlers: Record<string, (params: any) => Promise<any>> = {};
    const fakeServer = {
      tool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: (params: any) => Promise<any>
      ) {
        handlers[name] = handler;
      },
    };

    registerContextTools(fakeServer, apiClient, detector, queue, sprintService);
    const toolResult = await handlers.obter_contexto_projeto({
      diretorio_path: tmpDir,
    });
    const data = JSON.parse(toolResult.content[0].text);

    expect(data.mcp_ativo).toBe(true);
    expect(data.sprint_atual).not.toBeNull();
    expect(data.sprint_atual?.id).toBe(28);
    expect(data.sprint_atual?.nome).toBe('Sprint 9.0');
    expect(data.origem_sprint).toBe('api');
    expect(data.demandas_ativas).toHaveLength(1);
    expect(data.demandas_ativas[0].titulo).toBe('Integração Microsoft OAuth');

    // A listagem de demandas foi filtrada pela sprint ativa (?sprint=28).
    const demandasRequest = mockRequests.find(
      (r) => r.method === 'GET' && r.url === '/demandas'
    );
    expect(demandasRequest?.search).toContain('sprint=28');
    queue.close();
  });

  it('Tool 2: listar_demandas_ativas filters demands for the project', async () => {
    const { apiClient, queue } = createServer(testConfig);
    const demands = await apiClient.listDemandas({ projeto_id: 1 });

    expect(demands).toHaveLength(1);
    expect(demands[0].id).toBe(104);
    queue.close();
  });

  it('Tool 3: criar_demanda creates demand online with ITIL classification and priority', async () => {
    const { apiClient, queue } = createServer(testConfig);
    const result = await apiClient.createDemanda({
      projeto_id: 1,
      titulo: 'Implementar interceptor de autenticação no MCP',
      descricao: '<p>Necessário tratar expiração de sessão e fallback para fila offline.</p>',
      prioridade: 'Alta',
      impacto: 'media',
      status: 'para_fazer',
      responsavel_id: 4,
      data_inicio: '2026-08-18',
      data_limite: '2026-08-25',
      sprint_id: 2,
      classificacao_itil: 'requisicao',
      tipo_atendimento: 'desenvolvimento',
      estimativa_pontos: 5,
      solicitante: 'Nome do Solicitante',
    });

    expect(result.success).toBe(true);
    expect(result.id).toBe(200);
    expect(result.message).toBe('Demanda criada com sucesso!');
    queue.close();
  });

  it('Tool 3 (Offline fallback): criar_demanda enqueues into SQLite when API is offline', async () => {
    const offlineConfig = {
      ...testConfig,
      apiUrl: 'http://127.0.0.1:54321/api', // down
    };
    const { queue } = createServer(offlineConfig);

    const payload = {
      projeto_id: 1,
      titulo: 'Demanda Criada no Avião / Sem VPN',
      descricao: 'Trabalho offline',
      prioridade: 'Alta' as const,
      status: 'para_fazer' as const,
    };

    // Simulate tool fallback
    const queuedItem = queue.enqueue('demanda', payload);
    expect(queuedItem.client_id).toMatch(/^local_demanda_/);
    expect(queue.getPendingCount()).toBe(1);

    const pending = queue.getPendingItems();
    expect(pending[0].payload.titulo).toBe('Demanda Criada no Avião / Sem VPN');
    queue.close();
  });

  it('Tool 4: criar_subtarefa creates subtask attached to existing demand', async () => {
    const { apiClient, queue } = createServer(testConfig);
    const result = await apiClient.createSubtarefa(104, {
      titulo: 'Criar migration para índices de performance',
      descricao: 'Adicionar índice composto nas colunas status e data_limite',
      data_limite: '2026-08-22',
      responsavel_id: 4,
    });

    expect(result.success).toBe(true);
    expect(result.subtarefa?.id).toBe(45);
    expect(result.subtarefa?.demanda_id).toBe(104);
    queue.close();
  });

  it('Tool 5: sincronizar_fila_offline sends queued items when connection is restored', async () => {
    const { queue, syncService } = createServer(testConfig);

    // Enqueue 1 demand and 1 linked subtask offline
    const d = queue.enqueue('demanda', {
      projeto_id: 1,
      titulo: 'Demanda Offline 1',
      descricao: 'Desc',
      prioridade: 'Alta',
    });

    queue.enqueue('subtarefa', {
      demanda_id: d.client_id,
      titulo: 'Subtarefa Offline 1.1',
    });

    expect(queue.getPendingCount()).toBe(2);

    // Run sync
    const syncRes = await syncService.sync();
    expect(syncRes.succeeded).toBe(2);
    expect(syncRes.failed).toBe(0);
    expect(queue.getPendingCount()).toBe(0);
    expect(queue.getSyncedCount()).toBe(2);
    queue.close();
  });

  it('Tool 6: verificar_status_conexao returns accurate health and Sanctum user info', async () => {
    const { apiClient, queue } = createServer(testConfig);
    const conn = await apiClient.checkConnection();

    expect(conn.connected).toBe(true);
    expect(conn.user?.id).toBe(1);
    expect(conn.user?.name).toBe('Fulano da Silva');
    expect(conn.user?.email).toBe('fulano@empresa.gov.br');
    expect(queue.getPendingCount()).toBe(0);
    queue.close();
  });

  it('Subtask update & details: getDemandaDetalhes and updateSubtarefa work as expected', async () => {
    const { apiClient, queue } = createServer(testConfig);
    const details = await apiClient.getDemandaDetalhes(104);

    expect(details.id).toBe(104);
    expect(details.subtarefas).toHaveLength(2);

    const updateRes = await apiClient.updateSubtarefa(12, {
      titulo: 'Novo título atualizado',
      status: 'concluida',
    });
    expect(updateRes.success).toBe(true);
    queue.close();
  });

  it('atualizar_demanda updates a demand via PUT /demandas/:id', async () => {
    const { apiClient, queue } = createServer(testConfig);
    const result = await apiClient.updateDemanda(104, {
      titulo: 'Título revisado',
      descricao: 'Linha 1\n\nLinha 2 com & e <>',
      prioridade: 'Média',
      impacto: 'media',
      status: 'em_teste',
      data_limite: '2026-09-01',
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Demanda atualizada com sucesso');

    const updateRequest = mockRequests.find(
      (r) => r.method === 'PUT' && r.url === '/demandas/104'
    );
    expect(updateRequest).toBeDefined();
    expect(updateRequest?.body?.titulo).toBe('Título revisado');
    expect(updateRequest?.body?.prioridade).toBe('Média');
    expect(updateRequest?.body?.impacto).toBe('medio');
    expect(updateRequest?.body?.status).toBe('em_teste');
    expect(updateRequest?.body?._token).toBe('csrf-token-123');
    expect(updateRequest?.body?.descricao).toBe(
      '<p>Linha 1</p><p>Linha 2 com &amp; e &lt;&gt;</p>'
    );
    queue.close();
  });

  it('renovar_sessao refreshes session using provided or saved credentials', async () => {
    const { apiClient, queue, syncService } = createServer(testConfig);
    const handlers: Record<string, (params: any) => Promise<any>> = {};
    const fakeServer = {
      tool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: (params: any) => Promise<any>
      ) {
        handlers[name] = handler;
      },
    };

    const { registerSyncTools } = await import('../src/tools/syncTools.js');
    registerSyncTools(fakeServer, apiClient, queue, syncService);

    const result = await handlers.renovar_sessao({
      email: 'fulano@empresa.gov.br',
      password: 'mypassword',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('sucesso');
    expect(parsed.autenticado).toBe(true);
    expect(parsed.usuario?.id).toBe(1);
    queue.close();
  });

  it('concluir_subtarefas concludes multiple subtasks in batch in a single tool call', async () => {
    const { apiClient, queue, detector } = createServer(testConfig);
    const handlers: Record<string, (params: any) => Promise<any>> = {};
    const fakeServer = {
      tool(
        name: string,
        _description: string,
        _schema: unknown,
        handler: (params: any) => Promise<any>
      ) {
        handlers[name] = handler;
      },
    };

    const { registerSubtarefaTools } = await import('../src/tools/subtarefaTools.js');
    registerSubtarefaTools(fakeServer, apiClient, queue, detector);

    // 1. Passando lista de IDs
    const result = await handlers.concluir_subtarefas({
      subtarefa_ids: [12, 13],
      status: 'concluida',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('sucesso');
    expect(parsed.total_concluidas).toBe(2);
    expect(parsed.subtarefas_concluidas).toEqual([12, 13]);

    // 2. Passando demanda_id
    const resultDemanda = await handlers.concluir_subtarefas({
      demanda_id: 104,
      status: 'concluida',
    });
    const parsedDemanda = JSON.parse(resultDemanda.content[0].text);
    expect(parsedDemanda.status).toBe('sucesso');
    expect(parsedDemanda.total_atualizadas).toBeGreaterThanOrEqual(1);

    queue.close();
  });
});
