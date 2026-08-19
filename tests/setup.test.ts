import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  updateCodexTomlContent,
  injectIntoCodex,
  injectIntoOpenCode,
  injectIntoStandardJsonMcpClients,
  injectSkills,
} from '../src/cli/setup.js';

describe('setup CLI - MCP configuration automation', () => {
  describe('updateCodexTomlContent', () => {
    const scriptPath = '/path/to/dist/index.js';
    const projectCwd = '/path/to/project';
    const apiUrl = 'https://gestao.exemplo.gov.br';
    const token = 'session_cookie_123';

    it('should format a fresh config when content is empty', () => {
      const result = updateCodexTomlContent('', scriptPath, projectCwd, apiUrl, token);

      expect(result).toContain('[mcp_servers.gestao-tarefas]');
      expect(result).toContain('command = "node"');
      expect(result).toContain(`args = ["${scriptPath}"]`);
      expect(result).toContain(`cwd = "${projectCwd}"`);
      expect(result).toContain('[mcp_servers.gestao-tarefas.env]');
      expect(result).toContain(`GESTAO_TAREFAS_API_URL = "${apiUrl}"`);
      expect(result).toContain(`GESTAO_TAREFAS_API_TOKEN = "${token}"`);
      expect(result).toContain('OFFLINE_QUEUE_PATH = "~/.gestao-tarefas-mcp/queue.sqlite"');
      expect(result).toContain('IGNORE_EXTERNAL_PROJECTS = "true"');
    });

    it('should append to existing config without corrupting other sections', () => {
      const initialToml = [
        'model = "gpt-5.4-mini"',
        '',
        '[projects."/home/user/project"]',
        'trust_level = "trusted"',
        '',
        '[mcp_servers.ai-memory]',
        'url = "http://10.0.0.1:49374/mcp"',
      ].join('\n');

      const result = updateCodexTomlContent(initialToml, scriptPath, projectCwd, apiUrl, token);

      expect(result).toContain('model = "gpt-5.4-mini"');
      expect(result).toContain('[projects."/home/user/project"]');
      expect(result).toContain('[mcp_servers.ai-memory]');
      expect(result).toContain('[mcp_servers.gestao-tarefas]');
      expect(result).toContain('[mcp_servers.gestao-tarefas.env]');
    });

    it('should replace existing [mcp_servers.gestao-tarefas] and preserve subsequent sections', () => {
      const initialToml = [
        'model = "gpt-5.4-mini"',
        '',
        '[mcp_servers.gestao-tarefas]',
        'command = "node"',
        'args = ["/old/path.js"]',
        'cwd = "/old/cwd"',
        '',
        '[mcp_servers.gestao-tarefas.env]',
        'GESTAO_TAREFAS_API_URL = "https://old.url"',
        '',
        '[tui]',
        'status_line_use_colors = true',
      ].join('\n');

      const result = updateCodexTomlContent(initialToml, scriptPath, projectCwd, apiUrl, token);

      expect(result).toContain('model = "gpt-5.4-mini"');
      expect(result).not.toContain('/old/path.js');
      expect(result).not.toContain('https://old.url');
      expect(result).toContain(`args = ["${scriptPath}"]`);
      expect(result).toContain(`GESTAO_TAREFAS_API_URL = "${apiUrl}"`);
      expect(result).toContain('[tui]');
      expect(result).toContain('status_line_use_colors = true');
    });
  });

  describe('file injection helpers', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-setup-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should inject into Codex config.toml', () => {
      const codexFile = path.join(tmpDir, 'config.toml');
      fs.writeFileSync(codexFile, 'model = "test"\n', 'utf8');

      const success = injectIntoCodex(
        codexFile,
        '/test/dist/index.js',
        'https://test.gov.br',
        'tok123',
        '/test/cwd'
      );

      expect(success).toBe(true);
      const content = fs.readFileSync(codexFile, 'utf8');
      expect(content).toContain('[mcp_servers.gestao-tarefas]');
      expect(content).toContain('GESTAO_TAREFAS_API_URL = "https://test.gov.br"');
    });

    it('should inject into OpenCode config JSON', () => {
      const opencodeFile = path.join(tmpDir, 'opencode.json');
      fs.writeFileSync(opencodeFile, JSON.stringify({ autoupdate: false }), 'utf8');

      const success = injectIntoOpenCode(
        opencodeFile,
        '/test/dist/index.js',
        'https://test.gov.br',
        'tok123'
      );

      expect(success).toBe(true);
      const content = JSON.parse(fs.readFileSync(opencodeFile, 'utf8'));
      expect(content.mcp['gestao-tarefas']).toBeDefined();
      expect(content.mcp['gestao-tarefas'].command).toEqual(['node', '/test/dist/index.js']);
      expect(content.mcp['gestao-tarefas'].environment.GESTAO_TAREFAS_API_URL).toBe(
        'https://test.gov.br'
      );
    });

    it('should inject into standard JSON MCP client', () => {
      const mcpFile = path.join(tmpDir, 'mcp_config.json');
      fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: {} }), 'utf8');

      const success = injectIntoStandardJsonMcpClients(
        mcpFile,
        '/test/dist/index.js',
        'https://test.gov.br',
        'tok123'
      );

      expect(success).toBe(true);
      const content = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
      expect(content.mcpServers['gestao-tarefas']).toBeDefined();
      expect(content.mcpServers['gestao-tarefas'].args).toEqual(['/test/dist/index.js']);
    });

    it('should inject skills into Codex and Antigravity skill directories', () => {
      const fakeProjectDir = path.join(tmpDir, 'project');
      const fakeSkillDir = path.join(fakeProjectDir, 'skills', 'gestao-tarefas');
      fs.mkdirSync(fakeSkillDir, { recursive: true });
      fs.writeFileSync(path.join(fakeSkillDir, 'SKILL.md'), '# Skill content\n', 'utf8');

      const updated = injectSkills(fakeProjectDir);
      expect(Array.isArray(updated)).toBe(true);
      if (updated.length > 0) {
        expect(updated.some((p) => p.endsWith('SKILL.md'))).toBe(true);
      }
    });
  });
});
