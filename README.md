# MCP Gestão de Tarefas

Servidor independente baseado no Model Context Protocol (MCP) para integrar
agentes de desenvolvimento ao sistema de Gestão de Tarefas.

## Requisitos

- Node.js 22.5 ou superior;
- acesso ao servidor de Gestão de Tarefas;
- credenciais válidas ou um token de autenticação.

## Instalação

```bash
npm install
npm run build
```

## Configuração e autenticação

O assistente configura a URL do servidor e a autenticação localmente. A URL
pode ser informada pela variável `GESTAO_TAREFAS_API_URL`, pelo argumento
`--api-url` ou durante a execução do assistente.

```bash
npm run setup
```

Quando a URL não estiver configurada, o assistente solicitará:

```text
URL do Gestão de Tarefas:
```

Também é possível informar os dados de acesso por argumento:

```bash
npm run setup -- \
  --api-url=https://seu-servidor-de-gestao.exemplo \
  --email=seu.email@empresa.gov.br \
  --password=suasenha
```

Para usar uma sessão web ou um token já existente:

```bash
npm run setup -- --api-url=https://seu-servidor-de-gestao.exemplo --token=SEU_TOKEN
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
```

Não coloque tokens, senhas ou cookies em arquivos versionados.

## Funcionalidades

O servidor fornece ferramentas para:

- detectar o projeto atual e seu vínculo com o sistema;
- listar projetos, demandas e sprints;
- criar demandas e subtarefas;
- atualizar subtarefas e consultar detalhes de demandas;
- associar demandas a sprints;
- operar com fila offline e sincronizar os itens posteriormente;
- verificar a conectividade e o estado da autenticação.

Projetos da Prefeitura permanecem ativos por padrão. Projetos pessoais ou
externos podem ser ignorados por padrões configurados em
`IGNORED_PROJECT_PATTERNS`, pela variável `IGNORE_EXTERNAL_PROJECTS` ou pelo arquivo
`.gestaotarefas.json`. Projetos sem identificação também não podem criar
registros, evitando o uso acidental do MCP em outros repositórios.

## Execução

O servidor usa stdio e deve ser executado a partir do build:

```bash
npm run build
node dist/index.js
```

Exemplo de configuração para um cliente MCP:

```json
{
  "mcpServers": {
    "gestao-tarefas": {
      "command": "node",
      "args": ["/caminho/para/mcp-gestao-tarefas/dist/index.js"],
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

Após alterar o código, execute `npm run build` e reinicie o cliente MCP.

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
4. Execute npm run build.
5. Registre o servidor usando node dist/index.js e preserve as demais
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
npm test
```

A suíte cobre autenticação, detecção de contexto, bypass de projetos
ignorados, comunicação HTTP, fila offline, sincronização e ferramentas MCP.
