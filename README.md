# Servidor MCP Gestão de Tarefas (Standalone)

Servidor MCP (**Model Context Protocol**) independente para integração de agentes de Inteligência Artificial com o sistema corporativo de **Gestão de Tarefas** (Laravel).

---

## 🔑 Como Obter e Configurar a Autenticação

Na aplicação atual, as rotas de projetos, demandas e colaboradores usam a sessão web do Laravel. Por isso, o caminho recomendado é executar `npm run setup`: o MCP faz o login com CSRF, salva os cookies da sessão e os reutiliza nas próximas execuções. O suporte a Bearer Sanctum continua disponível para endpoints que aceitem esse tipo de autenticação.

### 🌟 Método 1: Assistente Automático de Instalação e Login (Recomendado)

O projeto inclui um assistente CLI que permite autenticar diretamente com seu **E-mail e Senha** (via API ou Web Session automatizada) ou gerar automaticamente se houver o Laravel local:

```bash
# Executa o assistente interativo
npm run setup
```

O assistente apresentará o menu:
```text
Escolha como deseja autenticar:
 [1] Login com E-mail e Senha (Automático via API / Web Session)
 [2] Gerar via Laravel Artisan local (Tinker)
 [3] Colar sessão web ou Bearer Token existente
```

#### Passando credenciais diretamente por linha de comando:
```bash
# Login direto com e-mail e senha
npm run setup -- --email=seu.email@empresa.gov.br --password=suasenha --api-url=https://seu-servidor-de-gestao.exemplo

# Ou apontando para o repositório Laravel local
npm run setup -- --laravel-path=../gestao-tarefas --email=seu.email@empresa.gov.br
```

---

### 💻 Método 2: Token Sanctum via Laravel (opcional)

Acesse a pasta do projeto Laravel (`gestao-tarefas`) e execute:

#### A. Para o primeiro usuário cadastrado:
```bash
php artisan tinker --execute="echo App\Models\User::first()->createToken('mcp-agent')->plainTextToken;"
```

#### B. Para um usuário específico por e-mail:
```bash
php artisan tinker --execute="echo App\Models\User::where('email', 'seu.email@empresa.gov.br')->first()->createToken('mcp-agent')->plainTextToken;"
```

#### C. Interativo no Tinker:
```bash
php artisan tinker
```
```php
$user = App\Models\User::where('email', 'seu.email@empresa.gov.br')->first();
$token = $user->createToken('mcp-agent')->plainTextToken;
echo $token;
```
Copie o texto gerado (ex: `1|0AbCdEfGhIjKlMnOpQrStUvWxYz1234567890`) e cole na variável `GESTAO_TAREFAS_API_TOKEN` no arquivo `.env`. Esse modo só funciona para rotas que a aplicação expõe com `auth:sanctum`; para as rotas web usadas na criação de demandas, prefira `npm run setup`.

---

## 🚀 Principais Recursos

1. **Inteligência e Reconhecimento de Contexto (*Project Awareness*):**
   - Resolução do projeto atual através de 3 camadas de fallback:
     - Leitura de `.gestaotarefas.json` no repositório corrente ou pastas pai.
     - Inspeção de remotos Git (`git remote -v`) e nome de pastas.
     - Resolução dinâmica via catálogo de projetos da API.
2. **Detecção e Desativação para Projetos da Prefeitura / Externos (*Bypass*):**
   - Identifica automaticamente quando o desenvolvedor está atuando em projetos da Prefeitura ou repositórios externos.
   - Desativa a criação de demandas, subtarefas e o disparo de eventos indesejados no Gestão de Tarefas.
   - Configurável via `.env` (`IGNORE_PREFEITURA=true`, `IGNORED_PROJECT_PATTERNS`) ou `.gestaotarefas.json` (`"ignorado": true`, `"tipo": "prefeitura"`).
3. **Operação Híbrida Online / Offline (*Outbox Pattern*):**
   - Operação transparente quando fora da VPN/intranet.
   - Armazenamento em fila local com SQLite nativo (`node:sqlite`).
   - Mapeamento inteligente de IDs temporários para subtarefas criadas antes da demanda ser enviada ao servidor.
4. **Catálogo Completo de Ferramentas MCP:**
   - `obter_contexto_projeto`: Detecta o projeto corrente, status de ativação do MCP, sprint ativa e demandas em andamento.
   - `listar_demandas_ativas`: Lista demandas com filtros por projeto, responsável e status.
   - `criar_demanda`: Cria nova demanda completa (com suporte a prioridade, ITIL, impacto, datas e fallback offline).
   - `criar_subtarefa`: Adiciona subtarefas vinculadas a demandas (inclusive demandas locais pendentes de sincronização).
   - `atualizar_subtarefa`: Atualiza status ou dados de uma subtarefa.
   - `obter_detalhes_demanda`: Retorna dados da demanda com todas as suas subtarefas.
   - `listar_sprints`: Lista as sprints visíveis em ordem da mais recente para a mais antiga.
   - `associar_demanda_sprint`: Vincula uma demanda a uma sprint de destino.
   - `sincronizar_fila_offline`: Envia todas as demandas e subtarefas pendentes na fila local.
   - `verificar_status_conexao`: Inspeciona sessão web ou Sanctum, conectividade e volume da fila offline.
   - `listar_projetos`: Lista projetos ativos disponíveis.

---

## 📦 Instalação e Execução

```bash
# 1. Instalar dependências
npm install

# 2. Configurar o token e ambiente (Assistente Automático)
npm run setup

# 3. Compilar TypeScript
npm run build

# 4. Executar testes
npm test
```

---

## 🔌 Configuração no Cliente MCP

O servidor é executado por **stdio** a partir do build local (`dist/index.js`).
Depois de alterar o código, execute `npm run build` e reinicie/reconecte o cliente
MCP para que ele carregue a versão nova. Não versionamos nem documentamos valores
de tokens: a autenticação fica no ambiente do cliente ou em
`~/.gestao-tarefas-mcp/config.json`.

### Exemplo de configuração no cliente MCP

O registro correspondente, adaptando os caminhos para o seu ambiente, é:

```json
{
  "mcpServers": {
    "gestao-tarefas": {
      "command": "node",
      "args": ["/caminho/para/mcp-gestao-tarefas/dist/index.js"],
      "env": {
        "GESTAO_TAREFAS_API_URL": "https://seu-servidor-de-gestao.exemplo",
        "GESTAO_TAREFAS_API_TOKEN": "<configurado localmente>",
        "OFFLINE_QUEUE_PATH": "~/.gestao-tarefas-mcp/queue.sqlite",
        "IGNORE_PREFEITURA": "true"
      }
    }
  }
}
```

O arquivo `settings.json` do Antigravity apenas autoriza ferramentas e lista
áreas de trabalho confiáveis; ele não é o registro do servidor MCP.

### Claude Desktop / Cursor / outros clientes

Adicione o servidor nas configurações de MCP do cliente (`claude_desktop_config.json` ou `mcpSettings.json`), adaptando o caminho absoluto:

```json
{
  "mcpServers": {
    "gestao-tarefas": {
      "command": "node",
      "args": ["/caminho/absoluto/para/mcp-gestao-tarefas/dist/index.js"],
      "env": {
        "GESTAO_TAREFAS_API_URL": "https://seu-servidor-de-gestao.exemplo",
        "GESTAO_TAREFAS_API_TOKEN": "COLE_A_SESSAO_WEB_OU_TOKEN_AQUI",
        "OFFLINE_QUEUE_PATH": "~/.gestao-tarefas-mcp/queue.sqlite",
        "IGNORE_PREFEITURA": "true"
      }
    }
  }
}
```

### Configuração automatizada pelo próprio agente

Também é possível pedir ao agente de desenvolvimento que configure o MCP no
próprio harness. Abra o cliente MCP ou outro agente com acesso ao workspace e
envie o prompt abaixo a partir da pasta do projeto:

```text
Configure o MCP gestao-tarefas para este workspace.

1. Leia o README.md e identifique o harness em que você está rodando.
2. Verifique se o diretório do projeto existe e execute npm install
   somente se as dependências estiverem ausentes.
3. Execute npm run build.
4. Registre ou atualize o servidor MCP gestao-tarefas na configuração do meu
   harness, preservando os demais servidores e configurações existentes.
5. Use o comando adequado ao harness, apontando para o caminho local deste
   projeto e executando `node dist/index.js`.
6. Mantenha a URL da API, a fila offline e IGNORE_PREFEITURA conforme este README.
7. Não mostre, copie, substitua ou grave tokens e senhas no chat, no código ou
   em commits. Se faltar autenticação, peça para eu executar npm run setup.
8. Valide a configuração iniciando o servidor MCP e liste as ferramentas
   disponíveis. Informe os arquivos alterados e peça para eu reiniciar ou
   reconectar o harness quando isso for necessário.
```

O agente deve pedir confirmação antes de sobrescrever uma configuração existente
ou instalar dependências. A configuração automática depende das permissões do
harness; se ele não puder editar os arquivos do cliente, deve fornecer o trecho
exato para aplicação manual. Depois de uma alteração no TypeScript, a sequência
é sempre `npm run build` e reinicialização/reconexão do cliente.

---

## 📂 Arquivo de Configuração Local no Projeto (`.gestaotarefas.json`)

### Para vincular um projeto ao Gestão de Tarefas:
```json
{
  "projeto_id": 1,
  "nome": "Gestão de Tarefas",
  "departamento": "TI"
}
```

### Para desativar/ignorar o MCP em um projeto da Prefeitura ou externo:
```json
{
  "nome": "Portal da Prefeitura",
  "tipo": "prefeitura",
  "ignorado": true,
  "motivo": "Projeto externo da Prefeitura - eventos desativados"
}
```

---

## 🧪 Testes

A suíte de testes valida o comportamento real esperado:
- Extração de tokens e persistência de configuração.
- Desativação e bypass automático de eventos em projetos da Prefeitura.
- Persistência e integridade da fila offline no SQLite.
- Detecção em múltiplos níveis de diretórios e tratamento de stopwords no nome do projeto.
- Comunicação HTTP, tratamento de erro 401 (Sanctum), erro 422 (Validação Laravel) e falhas de rede.
- Sincronização em cascata de demandas e subtarefas dependentes.
- Execução de ponta a ponta das ferramentas MCP.

```bash
npm test
```
