#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import axios from 'axios';
import { normalizeCookieHeader } from '../services/auth.js';

interface SetupOptions {
  email?: string;
  password?: string;
  apiUrl?: string;
  token?: string;
}

function parseArgs(): SetupOptions {
  const args = process.argv.slice(2);
  const options: SetupOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--email=')) {
      options.email = arg.split('=')[1];
    } else if (arg.startsWith('--password=')) {
      options.password = arg.split('=')[1];
    } else if (arg.startsWith('--api-url=')) {
      options.apiUrl = arg.split('=')[1];
    } else if (arg.startsWith('--token=')) {
      options.token = arg.split('=')[1];
    }
  }

  return options;
}

/**
 * Autenticação 100% remota e automatizada via API / Web Session do Gestão de Tarefas
 */
async function performAutomatedLogin(
  rawApiUrl: string,
  email: string,
  password: string
): Promise<{ authValue: string; user?: any }> {
  const baseUrl = rawApiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');

  // 1. Tenta login direto via JSON API caso exista endpoint de token
  const apiEndpoints = [
    `${baseUrl}/api/login`,
    `${baseUrl}/login/api`,
    `${baseUrl}/api/tokens/create`,
    `${baseUrl}/sanctum/token`,
  ];

  for (const endpoint of apiEndpoints) {
    try {
      const response = await axios.post(
        endpoint,
        { email, password, device_name: 'mcp-agent' },
        {
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          timeout: 7000,
        }
      );
      const data = response.data;
      const token = data?.token || data?.access_token || data?.plainTextToken;
      if (token && typeof token === 'string') {
        return { authValue: token, user: data?.user };
      }
    } catch {
      // continua para o próximo método
    }
  }

  // 2. Autenticação automatizada via Web Session / CSRF (Headless HTTP Session)
  const client = axios.create({
    baseURL: baseUrl,
    withCredentials: true,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
  });

  // Passo A: Obter formulário de login e cookies de sessão iniciais
  const loginPage = await client.get('/login', { timeout: 10000 });
  const initialCookies = loginPage.headers['set-cookie'] || [];
  const html = String(loginPage.data);

  const csrfMatch =
    html.match(/name=["']_token["']\s+value=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/i);
  const csrfToken = csrfMatch ? csrfMatch[1] : '';

  if (!csrfToken) {
    throw new Error('Não foi possível obter o token CSRF da página de login do Gestão de Tarefas.');
  }

  // Passo B: Submeter credenciais de login
  const cookieHeader = initialCookies.map((c) => c.split(';')[0]).join('; ');
  const formParams = new URLSearchParams();
  formParams.append('_token', csrfToken);
  formParams.append('email', email);
  formParams.append('password', password);

  const loginResponse = await client.post('/login', formParams.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader,
      Referer: `${baseUrl}/login`,
    },
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 400,
    timeout: 10000,
  });

  const postCookies = loginResponse.headers['set-cookie'] || [];
  const combinedCookies = normalizeCookieHeader(
    [...initialCookies, ...postCookies].map((c) => c.split(';', 1)[0]).join('; ')
  );

  // Se redirecionou de volta para /login, as credenciais são inválidas
  const redirectLocation = loginResponse.headers['location'] || '';
  if (redirectLocation.includes('/login') && !redirectLocation.includes('/home')) {
    throw new Error('Credenciais inválidas: e-mail ou senha incorretos.');
  }

  // Passo C: Testa acesso autenticado
  try {
    const testRes = await client.get('/colaboradores/listar/json', {
      headers: {
        Cookie: combinedCookies,
        Accept: 'application/json',
      },
      timeout: 5000,
    });
    if (testRes.status === 200) {
      return { authValue: combinedCookies };
    }
  } catch {
    // continua
  }

  return { authValue: combinedCookies };
}

function injectIntoMcpClients(scriptPath: string, apiUrl: string, token: string): string[] {
  const updatedFiles: string[] = [];
  const homedir = os.homedir();

  const targetConfigs = [
    path.join(homedir, '.gemini', 'config', 'mcp_config.json'),
    path.join(homedir, '.gemini', 'antigravity-cli', 'mcp_config.json'),
    path.join(homedir, '.config', 'Claude', 'claude_desktop_config.json'),
  ];

  for (const cfgPath of targetConfigs) {
    try {
      const dir = path.dirname(cfgPath);
      if (!fs.existsSync(dir)) {
        continue;
      }

      let configObj: any = { mcpServers: {} };
      if (fs.existsSync(cfgPath)) {
        try {
          configObj = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        } catch {
          configObj = { mcpServers: {} };
        }
      }

      if (!configObj.mcpServers) {
        configObj.mcpServers = {};
      }

      configObj.mcpServers['gestao-tarefas'] = {
        command: 'node',
        args: [scriptPath],
        env: {
          GESTAO_TAREFAS_API_URL: apiUrl,
          GESTAO_TAREFAS_API_TOKEN: token,
          OFFLINE_QUEUE_PATH: '~/.gestao-tarefas-mcp/queue.sqlite',
          IGNORE_EXTERNAL_PROJECTS: 'true',
        },
      };

      fs.writeFileSync(cfgPath, JSON.stringify(configObj, null, 2), 'utf8');
      updatedFiles.push(cfgPath);
    } catch {
      // ignore
    }
  }

  return updatedFiles;
}

async function promptInput(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const promptText = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
    rl.question(promptText, (answer) => {
      rl.close();
      process.stdin.pause();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

async function promptHiddenPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`${question}: `);
    let password = '';
    const stdin = process.stdin;
    const oldRaw = stdin.isRaw;

    if (stdin.isTTY) {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      const onData = (ch: string) => {
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          try {
            stdin.setRawMode(oldRaw || false);
          } catch {}
          stdin.removeListener('data', onData);
          stdin.pause();
          process.stdout.write('\n');
          resolve(password);
        } else if (ch === '\u0003') {
          process.exit(1);
        } else if (ch === '\u007f' || ch === '\b') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else {
          password += ch;
          process.stdout.write('*');
        }
      };

      stdin.on('data', onData);
    } else {
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question('', (ans) => {
        rl.close();
        stdin.pause();
        resolve(ans.trim());
      });
    }
  });
}

export async function runSetup() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🚀 MCP Gestão de Tarefas - Login e Configuração Automática');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const options = parseArgs();
  let token = options.token;
  let apiUrl =
    options.apiUrl ||
    process.env.GESTAO_TAREFAS_API_URL ||
    '';
  let email = options.email;
  let password = options.password;

  if (!apiUrl) {
    apiUrl = await promptInput('👉 URL do Gestão de Tarefas');
  }

  if (!apiUrl) {
    console.error('\n❌ A URL do Gestão de Tarefas é obrigatória.');
    process.exit(1);
  }

  // Se não foi fornecido token ou credenciais via linha de comando, solicita
  if (!token && (!email || !password)) {
    console.log(`🌐 Servidor: ${apiUrl}\n`);
    email = await promptInput('👉 Seu E-mail de login');
    password = await promptHiddenPassword('👉 Sua Senha');
  }

  // Realiza o login automático
  if (!token && email && password) {
    console.log('\n⏳ Realizando login automático no Gestão de Tarefas...');
    try {
      const result = await performAutomatedLogin(apiUrl, email, password);
      token = result.authValue;
      console.log('✅ Login realizado com sucesso!');
    } catch (err: any) {
      console.error(`\n❌ Falha na autenticação: ${err.message}`);
      console.error('   Verifique suas credenciais ou a conexão com o servidor.');
      process.exit(1);
    }
  }

  if (!token) {
    console.error('\n❌ Nenhum token ou credencial válida foi configurada.');
    process.exit(1);
  }

  // Compatibilidade com a aplicação atual: o login web fornece cookies de
  // sessão, não um Bearer token. Salvar um único valor por nome evita manter
  // uma sessão antiga e uma nova no mesmo Header Cookie.
  if (token.includes('XSRF-TOKEN') || token.includes(';')) {
    token = normalizeCookieHeader(token);
  }

  // 1. Salvar no arquivo .env
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  } else {
    const examplePath = path.resolve(process.cwd(), '.env.example');
    if (fs.existsSync(examplePath)) {
      envContent = fs.readFileSync(examplePath, 'utf8');
    }
  }

  const updateEnvKey = (content: string, key: string, value: string): string => {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      return content.replace(regex, `${key}=${value}`);
    }
    return `${content}\n${key}=${value}`.trim() + '\n';
  };

  envContent = updateEnvKey(envContent, 'GESTAO_TAREFAS_API_URL', apiUrl);
  envContent = updateEnvKey(envContent, 'GESTAO_TAREFAS_API_TOKEN', token);
  envContent = updateEnvKey(envContent, 'OFFLINE_QUEUE_PATH', '~/.gestao-tarefas-mcp/queue.sqlite');
  envContent = updateEnvKey(envContent, 'IGNORE_EXTERNAL_PROJECTS', 'true');

  fs.writeFileSync(envPath, envContent, 'utf8');

  // 2. Salva também globalmente em ~/.gestao-tarefas-mcp/config.json
  const userConfigDir = path.join(os.homedir(), '.gestao-tarefas-mcp');
  if (!fs.existsSync(userConfigDir)) {
    fs.mkdirSync(userConfigDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(userConfigDir, 'config.json'),
    JSON.stringify({ apiUrl, apiToken: token, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );

  // 3. Injeta automaticamente nos arquivos de configuração do Antigravity / Claude
  const scriptPath = path.resolve(process.cwd(), 'dist/index.js');
  const injectedConfigs = injectIntoMcpClients(scriptPath, apiUrl, token);

  console.log('\n✅ Configuração e Token salvos com sucesso!');
  console.log(`   🌐 API URL: ${apiUrl}`);
  console.log(`   📁 Arquivo .env atualizado`);
  console.log(`   💾 Cache global atualizado (~/.gestao-tarefas-mcp/config.json)`);

  if (injectedConfigs.length > 0) {
    console.log('\n🤖 Token injetado automaticamente nos clientes MCP detectados:');
    injectedConfigs.forEach((c) => console.log(`   ✓ ${c}`));
  }

  console.log('\n🎉 Tudo pronto! Não é necessário colar nada manualmente. O MCP já está ativo no Antigravity!\n');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  runSetup()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Erro durante o setup:', err);
      process.exit(1);
    });
}
