#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { createServer } from './server.js';

async function main() {
  const { server } = createServer(config);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[mcp-gestao-tarefas] MCP Server rodando via stdio...');
  console.error(`[mcp-gestao-tarefas] API URL: ${config.apiUrl}`);
  console.error(`[mcp-gestao-tarefas] Offline Queue Path: ${config.offlineQueuePath}`);
}

main().catch((err) => {
  console.error('[mcp-gestao-tarefas] Erro fatal:', err);
  process.exit(1);
});
