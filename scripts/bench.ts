/**
 * Benchmark de partida, memória e latência do servidor MCP via stdio.
 *
 * Uso:
 *   bun scripts/bench.ts                                   # mede dist/mcp-gestao-tarefas
 *   bun scripts/bench.ts "aot=./dist/mcp-gestao-tarefas" "node=node /outro/dist/index.js"
 *
 * Cada alvo é `rótulo=comando`. Por execução: inicia o processo, mede o tempo
 * até a resposta do `initialize`, o RSS ocioso, a latência média de
 * `tools/list` e de `obter_contexto_projeto` (local, sem rede) e o pico de
 * RSS. Reporta a mediana das execuções após uma rodada de aquecimento. A HOME
 * é isolada e a API aponta para uma porta inalcançável. Somente Linux (/proc).
 */
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

const RUNS = Number(process.env.BENCH_RUNS ?? 15);
const LIST_CALLS = 500;
const CONTEXT_CALLS = 100;

interface Sample {
  startupMs: number;
  idleRssMB: number;
  loadRssMB: number;
  peakRssMB: number;
  toolsListUs: number;
  contextoMs: number;
}

function readMemoryMB(pid: number): { rss: number; peak: number } {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const field = (key: string) => {
    const match = status.match(new RegExp(`${key}:\\s+(\\d+)`));
    if (!match) throw new Error(`campo ${key} ausente em /proc/${pid}/status`);
    return Number(match[1]) / 1024;
  };
  return { rss: field('VmRSS'), peak: field('VmHWM') };
}

async function measure(command: string[]): Promise<Sample> {
  const home = mkdtempSync(path.join(os.tmpdir(), 'mcp-bench-home-'));
  const started = performance.now();
  const proc = Bun.spawn(command, {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: home,
      GESTAO_TAREFAS_API_URL: 'http://127.0.0.1:9',
      GESTAO_TAREFAS_API_TOKEN: 'bench',
      OFFLINE_QUEUE_PATH: path.join(home, 'queue.sqlite'),
    },
  });

  const pending = new Map<number, () => void>();
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk);
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const message: { id?: number } = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (message.id !== undefined) pending.get(message.id)?.();
      }
    }
  })();

  let nextId = 0;
  const send = (payload: Record<string, unknown>) => {
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...payload }) + '\n');
    proc.stdin.flush();
  };
  const request = (method: string, params: Record<string, unknown> = {}) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const id = ++nextId;
    pending.set(id, resolve);
    send({ id, method, params });
    return promise;
  };

  try {
    await request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'bench', version: '1' },
    });
    const startupMs = performance.now() - started;
    send({ method: 'notifications/initialized' });
    const idle = readMemoryMB(proc.pid);

    let t = performance.now();
    for (let i = 0; i < LIST_CALLS; i++) await request('tools/list');
    const toolsListUs = ((performance.now() - t) / LIST_CALLS) * 1000;

    t = performance.now();
    for (let i = 0; i < CONTEXT_CALLS; i++) {
      await request('tools/call', {
        name: 'obter_contexto_projeto',
        arguments: { diretorio_path: process.cwd() },
      });
    }
    const contextoMs = (performance.now() - t) / CONTEXT_CALLS;
    const loaded = readMemoryMB(proc.pid);

    return {
      startupMs,
      idleRssMB: idle.rss,
      loadRssMB: loaded.rss,
      peakRssMB: loaded.peak,
      toolsListUs,
      contextoMs,
    };
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(home, { recursive: true, force: true });
  }
}

const targets = (process.argv.length > 2 ? process.argv.slice(2) : ['bun-aot=./dist/mcp-gestao-tarefas']).map(
  (arg) => {
    const separator = arg.indexOf('=');
    if (separator <= 0) throw new Error(`alvo inválido "${arg}": use rótulo=comando`);
    return { label: arg.slice(0, separator), command: arg.slice(separator + 1).split(/\s+/) };
  }
);

const results: Array<Record<string, string | number>> = [];
for (const { label, command } of targets) {
  await measure(command);
  const samples: Sample[] = [];
  for (let run = 0; run < RUNS; run++) samples.push(await measure(command));

  const row: Record<string, string | number> = { alvo: label };
  for (const key of Object.keys(samples[0]) as Array<keyof Sample>) {
    const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
    row[key] = Number(sorted[sorted.length >> 1].toFixed(key === 'toolsListUs' ? 0 : 1));
  }
  results.push(row);
}

console.table(results);
