import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ContextDetector } from '../src/services/contextDetector.js';

describe('ContextDetector (Project Awareness)', () => {
  let tmpDir: string;
  let detector: ContextDetector;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-context-test-'));
    detector = new ContextDetector();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should detect project from .gestaotarefas.json in current directory', async () => {
    const configData = {
      projeto_id: 10,
      nome: 'Portal de Serviços',
      departamento: 'TI',
    };
    fs.writeFileSync(
      path.join(tmpDir, '.gestaotarefas.json'),
      JSON.stringify(configData, null, 2)
    );

    const result = await detector.detectProject(tmpDir);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(10);
    expect(result?.nome).toBe('Portal de Serviços');
    expect(result?.departamento).toBe('TI');
    expect(result?.source).toBe('config_file');
  });

  it('should detect project from .gestaotarefas.json in a parent directory', async () => {
    const configData = {
      projeto_id: 42,
      nome: 'Sistema Corporativo',
    };
    fs.writeFileSync(
      path.join(tmpDir, '.gestaotarefas.json'),
      JSON.stringify(configData)
    );

    // Create deep nested subdirectories
    const nestedDir = path.join(tmpDir, 'src', 'components', 'button');
    fs.mkdirSync(nestedDir, { recursive: true });

    const result = await detector.detectProject(nestedDir);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(42);
    expect(result?.nome).toBe('Sistema Corporativo');
    expect(result?.source).toBe('config_file');
  });

  it('should detect project matching folder name with available projects list', async () => {
    const folderPath = path.join(tmpDir, 'gestao-tarefas');
    fs.mkdirSync(folderPath);

    const availableProjects = [
      { id: 1, nome: 'Gestão de Tarefas', status: 'ativo' },
      { id: 2, nome: 'Outro Projeto', status: 'ativo' },
    ];

    const result = await detector.detectProject(folderPath, availableProjects);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(1);
    expect(result?.nome).toBe('Gestão de Tarefas');
    expect(result?.source).toBe('folder_name');
  });

  it('should save .gestaotarefas.json configuration file successfully', async () => {
    const savedPath = detector.saveConfigFile(tmpDir, {
      projeto_id: 99,
      nome: 'Novo Repositório',
      departamento: 'Engenharia',
    });

    expect(fs.existsSync(savedPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    expect(content.projeto_id).toBe(99);
    expect(content.nome).toBe('Novo Repositório');
  });

  it('should return null when no project config or match exists', async () => {
    const emptyDir = path.join(tmpDir, 'random-unrelated-folder');
    fs.mkdirSync(emptyDir);

    const result = await detector.detectProject(emptyDir, []);
    expect(result).toBeNull();
  });

  it('should cache the remote project list for repeated detection', async () => {
    const projectDir = path.join(tmpDir, 'gestao-tarefas');
    fs.mkdirSync(projectDir);
    let listCalls = 0;
    const apiClient = {
      listProjetos: async () => {
        listCalls += 1;
        return [{ id: 1, nome: 'Gestão de Tarefas', status: 'ativo' }];
      },
    } as any;
    const cachedDetector = new ContextDetector(apiClient, { ignorePrefeitura: false });

    const first = await cachedDetector.detectProject(projectDir);
    const second = await cachedDetector.detectProject(projectDir);

    expect(first?.id).toBe(1);
    expect(second?.id).toBe(1);
    expect(listCalls).toBe(1);
  });
});
