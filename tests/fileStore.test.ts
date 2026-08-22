import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeFileAtomic } from '../src/services/fileStore.js';

describe('fileStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-file-store-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes replacement content atomically without leaving temp files', () => {
    const target = path.join(tmpDir, 'nested', 'config.json');

    writeFileAtomic(target, '{"version":1}\n');
    writeFileAtomic(target, '{"version":2}\n');

    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ version: 2 });
    expect(fs.readdirSync(path.dirname(target))).toEqual(['config.json']);
  });
});
