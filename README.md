# MCP Gestão de Tarefas

Servidor independente baseado no Model Context Protocol (MCP) para integrar
agentes de desenvolvimento ao sistema de Gestão de Tarefas.

## Requisitos

- [Bun](https://bun.sh) 1.4 ou superior (apenas para compilar; o binário gerado é autônomo);
- acesso ao servidor de Gestão de Tarefas;
- credenciais válidas ou um token de autenticação.

## Instalação

```bash
bun install
bun run build
```

O build gera o executável autônomo `dist/mcp-gestao-tarefas` com
`bun build --compile --bytecode` (código pré-compilado para bytecode, sem
dependência de Node.js ou Bun em tempo de execução).

## Configuração e autenticação

O assistente configura a URL do servidor e a autenticação localmente. A URL
pode ser informada pela variável `GESTAO_TAREFAS_API_URL`, pelo argumento
`--api-url` ou durante a execução do assistente.

```bash
bun run setup
```

Quando a URL não estiver configurada no ambiente, o assistente sugerirá o padrão da Codemar:

```text
URL do Gestão de Tarefas (https://gestaotarefas-codemar.marica.rj.gov.br):
```

Também é possível informar os dados de acesso por argumento:

```bash
bun run setup -- \
  --api-url=https://seu-servidor-de-gestao.exemplo \
  --email=seu.email@empresa.gov.br \
  --password=suasenha
```

Para usar uma sessão web ou um token já existente:

```bash
bun run setup -- --api-url=https://seu-servidor-de-gestao.exemplo --token=SEU_TOKEN
```

O assistente tenta autenticar por endpoint JSON e, caso não esteja disponível,
usa o formulário web com CSRF. As credenciais não são versionadas. A sessão ou
o token são gravados no `.env` local e em `~/.gestao-tarefas-mcp/config.json`.

Uma sessão web ou um token existente pode ser informado ao assistente ou
configurado em `GESTAO_TAREFAS_API_TOKEN`.

## Variáveis de ambiente

O arquivo `.env.example` contém a configuração de referência:

```dotenv
GESTAO_TAREFAS_API_URL=https://seu-servidor-de-gestao.exemplo
GESTAO_TAREFAS_API_TOKEN=cole_a_sessao_web_ou_token_aqui
OFFLINE_QUEUE_PATH=~/.gestao-tarefas-mcp/queue.sqlite
REQUEST_TIMEOUT_MS=5000
IGNORE_EXTERNAL_PROJECTS=true
IGNORED_PROJECT_PATTERNS=pessoal,personal,externo
DAILY_SCAN_DIRS=~/Work
DAILY_GIT_AUTHOR_EMAIL=seu.email@empresa.gov.br
```

Não coloque tokens, senhas ou cookies em arquivos versionados.

## Funcionalidades

O servidor fornece ferramentas para:

- detectar o projeto atual e seu vínculo com o sistema;
- listar projetos, demandas e sprints;
- criar demandas e subtarefas;
- atualizar demandas e subtarefas, e consultar detalhes de demandas;
- associar demandas a sprints;
- operar com fila offline e sincronizar os itens posteriormente;
- verificar a conectividade e o estado da autenticação;
- montar e registrar a daily automaticamente a partir da atividade git local.

### Daily automática

As ferramentas `rascunho_daily` e `criar_daily` automatizam o preenchimento da
daily. Informe a janela de horário do dia (por exemplo, a daily das 17h) e o
agente:

1. coleta as sugestões de demandas, subtarefas, afazeres e impedimentos direto
   do Gestão de Tarefas;
2. varre os repositórios git sob `DAILY_SCAN_DIRS` em busca de commits do autor
   (`DAILY_GIT_AUTHOR_EMAIL`) e arquivos em alteração na janela informada;
3. devolve um rascunho pré-preenchido (`ontem`, `hoje`, observações com a
   atividade por repositório e impedimentos) para revisão;
4. grava a daily revisada com `criar_daily`.

`rascunho_daily` não grava nada; `criar_daily` respeita a regra de uma daily por
usuário/data — se já existir, retorna o id e o resumo da daily registrada.

Projetos da Prefeitura permanecem ativos por padrão. Projetos pessoais ou
externos podem ser ignorados por padrões configurados em
`IGNORED_PROJECT_PATTERNS`, pela variável `IGNORE_EXTERNAL_PROJECTS` ou pelo arquivo
`.gestaotarefas.json`. Projetos sem identificação também não podem criar
registros, evitando o uso acidental do MCP em outros repositórios.

## Execução

O servidor usa stdio e é executado pelo binário compilado:

```bash
bun run build
./dist/mcp-gestao-tarefas
```

Exemplo para o **Claude Code** (`~/.claude.json`), **Claude Desktop** (`claude_desktop_config.json`), **Antigravity CLI** e **Cursor**:

```json
{
  "mcpServers": {
    "gestao-tarefas": {
      "command": "/caminho/para/mcp-gestao-tarefas/dist/mcp-gestao-tarefas",
      "args": [],
      "env": {
        "GESTAO_TAREFAS_API_URL": "https://seu-servidor-de-gestao.exemplo",
        "GESTAO_TAREFAS_API_TOKEN": "CONFIGURADO_LOCALMENTE",
        "OFFLINE_QUEUE_PATH": "~/.gestao-tarefas-mcp/queue.sqlite",
        "IGNORE_EXTERNAL_PROJECTS": "true"
      }
    }
  }
}
```

Também é possível adicionar no **Claude Code** via linha de comando:

```bash
claude mcp add --env GESTAO_TAREFAS_API_URL=https://seu-servidor-de-gestao.exemplo \
  --env GESTAO_TAREFAS_API_TOKEN=CONFIGURADO_LOCALMENTE \
  --env OFFLINE_QUEUE_PATH=~/.gestao-tarefas-mcp/queue.sqlite \
  --env IGNORE_EXTERNAL_PROJECTS=true \
  --transport stdio gestao-tarefas -- /caminho/para/mcp-gestao-tarefas/dist/mcp-gestao-tarefas
```

Exemplo para o **Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.gestao-tarefas]
command = "/caminho/para/mcp-gestao-tarefas/dist/mcp-gestao-tarefas"
cwd = "/caminho/para/mcp-gestao-tarefas"

[mcp_servers.gestao-tarefas.env]
GESTAO_TAREFAS_API_URL = "https://seu-servidor-de-gestao.exemplo"
GESTAO_TAREFAS_API_TOKEN = "CONFIGURADO_LOCALMENTE"
OFFLINE_QUEUE_PATH = "~/.gestao-tarefas-mcp/queue.sqlite"
IGNORE_EXTERNAL_PROJECTS = "true"
```

Exemplo para o **OpenCode** (`~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "gestao-tarefas": {
      "type": "local",
      "command": ["/caminho/para/mcp-gestao-tarefas/dist/mcp-gestao-tarefas"],
      "enabled": true,
      "environment": {
        "GESTAO_TAREFAS_API_URL": "https://seu-servidor-de-gestao.exemplo",
        "GESTAO_TAREFAS_API_TOKEN": "CONFIGURADO_LOCALMENTE",
        "OFFLINE_QUEUE_PATH": "~/.gestao-tarefas-mcp/queue.sqlite",
        "IGNORE_EXTERNAL_PROJECTS": "true"
      }
    }
  }
}
```

### Harness Pi

O [Pi](https://pi.dev) não possui MCP nativo: o suporte vem do pacote
[pi-mcp-adapter](https://pi.dev/packages/pi-mcp-adapter). O `bun run setup`
detecta o diretório do agente (`~/.pi/agent`, ou `PI_CODING_AGENT_DIR`),
grava o servidor em `~/.pi/agent/mcp.json`, instala a skill em
`~/.pi/agent/skills/` e executa `pi install npm:pi-mcp-adapter` quando o
binário `pi` está disponível. Configuração manual equivalente:

```bash
pi install npm:pi-mcp-adapter
```

```json
{
  "mcpServers": {
    "gestao-tarefas": {
      "command": "/caminho/para/mcp-gestao-tarefas/dist/mcp-gestao-tarefas",
      "args": [],
      "env": {
        "GESTAO_TAREFAS_API_URL": "https://seu-servidor-de-gestao.exemplo",
        "GESTAO_TAREFAS_API_TOKEN": "CONFIGURADO_LOCALMENTE",
        "OFFLINE_QUEUE_PATH": "~/.gestao-tarefas-mcp/queue.sqlite",
        "IGNORE_EXTERNAL_PROJECTS": "true"
      }
    }
  }
}
```

Após alterar o código, execute `bun run build` e reinicie o cliente MCP.

A visão geral dos componentes e dos fluxos está em
[ARCHITECTURE.md](ARCHITECTURE.md).

## Configuração por agente de desenvolvimento

Um agente com acesso ao workspace pode configurar o servidor seguindo esta
sequência:

```text
Configure o servidor MCP deste projeto.

1. Leia o README.md e identifique o cliente MCP em uso.
2. Use o diretório atual como diretório do projeto.
3. Instale as dependências apenas se necessário.
4. Execute bun run build.
5. Registre o servidor usando o binário dist/mcp-gestao-tarefas e preserve as demais
   configurações existentes do cliente.
6. Solicite a URL do servidor e a autenticação caso ainda não estejam
   configuradas. Não exiba nem grave tokens ou senhas no chat.
7. Inicie o servidor ou informe que o cliente precisa ser reiniciado.
```

O agente deve pedir confirmação antes de sobrescrever configurações existentes
ou instalar dependências. Se não tiver permissão para alterar a configuração do
cliente, deve fornecer as instruções para aplicação manual.

## Configuração do projeto

O arquivo `.gestaotarefas.json` deve ser criado na raiz do repositório que será
integrado ao Gestão de Tarefas, no mesmo nível do diretório `.git`:

```text
meu-projeto/
├── .git/
├── .gestaotarefas.json
├── package.json
└── src/
```

O MCP procura esse arquivo a partir do diretório atual e continua subindo pelas
pastas pai. Assim, uma configuração colocada em uma pasta comum também pode
ser compartilhada por vários repositórios. O nome alternativo
`.gestao-tarefas.json` também é aceito.

Para vincular o repositório a um projeto, crie `meu-projeto/.gestaotarefas.json`
com o identificador correspondente:

```json
{
  "projeto_id": 1,
  "nome": "Gestão de Tarefas",
  "departamento": "TI"
}
```

Para desativar o MCP somente nesse repositório, use o mesmo arquivo:

```json
{
  "nome": "Projeto externo",
  "tipo": "externo",
  "ignorado": true,
  "motivo": "Projeto fora do escopo"
}
```

## Testes

```bash
bun test
```

A suíte cobre autenticação, detecção de contexto, bypass de projetos
ignorados, comunicação HTTP, fila offline, sincronização e ferramentas MCP.
A checagem de tipos roda com `bun run typecheck`.

## Desempenho

`bun run bench` mede o servidor via stdio: tempo até a resposta do
`initialize`, RSS ocioso, latência de `tools/list` (500 chamadas) e de
`obter_contexto_projeto` (100 chamadas, sem rede) e pico de RSS. Cada alvo roda
15 vezes (`BENCH_RUNS`) após um aquecimento e o resultado é a mediana. A HOME
é isolada e a API aponta para uma porta inalcançável. Requer Linux (`/proc`).

Por padrão o alvo é `dist/mcp-gestao-tarefas`; outros alvos são passados como
`rótulo=comando`. Para comparar com o build anterior em Node (`tsc` +
`node dist/index.js`, commit `5489dc5`):

```bash
git worktree add /tmp/mcp-node 5489dc5
(cd /tmp/mcp-node && npm ci && npx tsc)
bun run build
bun scripts/bench.ts "node=node /tmp/mcp-node/dist/index.js" \
  "bun-jit=bun src/index.ts" "bun-aot=./dist/mcp-gestao-tarefas"
git worktree remove --force /tmp/mcp-node
```

Resultado medido (Node v26.12.1, Bun 1.4.2, Linux x64):

| Métrica | Node (`tsc`) | Bun sem compilar | Bun AOT |
|---|---:|---:|---:|
| Partida até `initialize` (ms) | 229 | 164 | 48 |
| RSS ocioso (MB) | 98 | 78 | 60 |
| RSS após carga / pico (MB) | 134 | 114 | 104 |
| `tools/list` (µs) | 502 | 496 | 500 |
| `obter_contexto_projeto` (ms) | 6,8 | 4,9 | 4,9 |

O ganho de partida vem principalmente do AOT (arquivo único minificado com
bytecode, sem resolução de módulos em `node_modules`). A latência por chamada é
dominada pelo stdio e pela serialização JSON, por isso fica igual.
