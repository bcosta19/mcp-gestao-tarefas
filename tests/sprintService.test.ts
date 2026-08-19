import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ApiClient } from '../src/services/apiClient.js';
import { OfflineQueue } from '../src/services/offlineQueue.js';
import { SprintService } from '../src/services/sprintService.js';

function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toBrDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

describe('SprintService (persistência local + intervalo)', () => {
  let server: http.Server;
  let baseUrl: string;
  let tmpDir: string;
  let queue: OfflineQueue;
  let apiClient: ApiClient;
  let sprintService: SprintService;
  let requests: Array<{ method: string; path: string; search: string }> = [];

  const hoje = todayISO();
  const passado = addDays(hoje, -30);
  const futuro = addDays(hoje, 30);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      requests.push({ method: req.method || 'GET', path: url.pathname, search: url.search });

      if (req.method === 'GET' && url.pathname === '/sprints') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<table><tbody>
          <tr>
            <td data-col="inicio"><div class="sprint-date">${toBrDate(passado)}</div></td>
            <td data-col="fim"><div class="sprint-date">${toBrDate(futuro)}</div></td>
            <td data-col="status" data-order="ativa"><span class="status-badge status-ativa">Ativa</span></td>
            <td><button data-sprint-nome="Sprint 9.0" data-show-url="/sprints/28"></button></td>
          </tr>
        </tbody></table>`);
        return;
      }

      if (req.method === 'GET' && url.pathname === '/demandas') {
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

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-sprint-test-'));
    queue = new OfflineQueue(path.join(tmpDir, 'queue.sqlite'));
    apiClient = new ApiClient({
      apiUrl: baseUrl,
      apiToken: 'test-token',
      offlineQueuePath: path.join(tmpDir, 'queue.sqlite'),
      requestTimeoutMs: 2000,
    });
    sprintService = new SprintService(apiClient, queue);
    requests = [];
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('usa a sprint do cache local sem chamar a rede quando o intervalo cobre hoje', async () => {
    queue.saveSprints([
      { id: 27, nome: 'Sprint 8.0', data_inicio: passado, data_fim: futuro, status: 'ativa' },
    ]);

    const result = await sprintService.resolveActiveSprint();

    expect(result.fonte).toBe('cache');
    expect(result.online).toBe(false);
    expect(result.sprint?.id).toBe(27);
    expect(result.sprint?.nome).toBe('Sprint 8.0');
    // Nenhuma chamada HTTP foi feita.
    expect(requests.filter((r) => r.path === '/sprints')).toHaveLength(0);
  });

  it('atualiza o cache quando o intervalo local não cobre mais hoje (fonte api)', async () => {
    // Sprint antiga, encerrada antes de hoje.
    queue.saveSprints([
      { id: 26, nome: 'Sprint 7.0', data_inicio: addDays(passado, -30), data_fim: passado, status: 'concluida' },
    ]);

    const result = await sprintService.resolveActiveSprint();

    expect(result.fonte).toBe('api');
    expect(result.online).toBe(true);
    expect(result.sprint?.id).toBe(28);
    expect(result.sprint?.nome).toBe('Sprint 9.0');
    expect(result.sprint?.data_inicio).toBe(passado);
    expect(result.sprint?.data_fim).toBe(futuro);
    expect(result.sprint?.status).toBe('ativa');
    expect(requests.filter((r) => r.path === '/sprints')).toHaveLength(1);

    // Cache local atualizado para a próxima consulta offline.
    const cached = queue.getSprints();
    expect(cached.some((s) => s.id === 28 && s.fetched_at)).toBe(true);
  });

  it('mantém a última sprint conhecida com fonte offline quando a API está fora', async () => {
    const offlineClient = new ApiClient({
      apiUrl: 'http://127.0.0.1:54321/api', // porta sem servidor
      apiToken: 'test-token',
      offlineQueuePath: path.join(tmpDir, 'queue.sqlite'),
      requestTimeoutMs: 300,
    });
    const offlineService = new SprintService(offlineClient, queue);

    queue.saveSprints([
      { id: 26, nome: 'Sprint 7.0', data_inicio: addDays(passado, -30), data_fim: passado, status: 'concluida' },
    ]);

    const result = await offlineService.resolveActiveSprint();

    expect(result.fonte).toBe('offline');
    expect(result.online).toBe(false);
    expect(result.sprint?.id).toBe(26);
  });

  it('getDemandasDaSprint envia o filtro de sprint para o servidor', async () => {
    const demandas = await sprintService.getDemandasDaSprint(1, 28);

    expect(demandas).toHaveLength(1);
    expect(demandas[0].titulo).toBe('Integração Microsoft OAuth');
    expect(requests.some((r) => r.path === '/demandas' && r.search.includes('sprint=28'))).toBe(true);
  });
});
