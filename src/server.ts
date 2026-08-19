import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AppConfig } from './config.js';
import { ApiClient } from './services/apiClient.js';
import { OfflineQueue } from './services/offlineQueue.js';
import { ContextDetector } from './services/contextDetector.js';
import { SyncService } from './services/syncService.js';
import { SprintService } from './services/sprintService.js';
import { registerContextTools } from './tools/contextTools.js';
import { registerDemandaTools } from './tools/demandaTools.js';
import { registerSubtarefaTools } from './tools/subtarefaTools.js';
import { registerSyncTools } from './tools/syncTools.js';
import { registerSprintTools } from './tools/sprintTools.js';

export interface ServerInstance {
  server: McpServer;
  apiClient: ApiClient;
  queue: OfflineQueue;
  detector: ContextDetector;
  syncService: SyncService;
  sprintService: SprintService;
}

export function createServer(config: AppConfig): ServerInstance {
  const server = new McpServer({
    name: 'mcp-gestao-tarefas',
    version: '1.0.0',
  });

  const apiClient = new ApiClient(config);
  const queue = new OfflineQueue(config.offlineQueuePath);
  const detector = new ContextDetector(apiClient, config);
  const syncService = new SyncService(apiClient, queue);
  const sprintService = new SprintService(apiClient, queue);

  // Register all tools
  registerContextTools(server, apiClient, detector, queue, sprintService);
  registerDemandaTools(server, apiClient, queue, detector);
  registerSubtarefaTools(server, apiClient, queue, detector);
  registerSyncTools(server, apiClient, queue, syncService);
  registerSprintTools(server, apiClient, queue);

  return {
    server,
    apiClient,
    queue,
    detector,
    syncService,
    sprintService,
  };
}
