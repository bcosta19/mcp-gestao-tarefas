import os from 'os';

/**
 * Diretório home do usuário. No Bun, `os.homedir()` não reflete alterações
 * em `HOME` feitas em tempo de execução (no Node reflete), então a variável
 * de ambiente é consultada primeiro.
 */
export function homeDir(): string {
  return process.env.HOME || os.homedir();
}
