---
name: gestao-tarefas
description: "Protocolo obrigatório para usar o MCP `mcp-gestao-tarefas` ao interagir com o aplicativo/API Gestão de Tarefas da Prefeitura de Maricá / Codemar. Use sempre que for criar, consultar, atualizar ou concluir demandas, subtarefas, sprints, projetos ou dailies, e antes de registrar qualquer trabalho no aplicativo."
---

# Protocolo do MCP `mcp-gestao-tarefas`

Regras de negócio, tomada de decisão e sequência correta das chamadas das
ferramentas expostas pelo MCP `mcp-gestao-tarefas` para operar o aplicativo
**Gestão de Tarefas**.

## Diferencie MCP e aplicativo

Estes dois nomes não são sinônimos:

| Nome | O que é | Papel no fluxo |
| --- | --- | --- |
| `mcp-gestao-tarefas` | Servidor MCP / camada de integração. | Expõe as ferramentas ao agente, valida contexto do diretório, trata autenticação e mantém a fila offline local. Não é a fonte da verdade das demandas. |
| **Gestão de Tarefas** | Aplicativo web/API da Prefeitura de Maricá / Codemar. | Sistema onde projetos, sprints, demandas, subtarefas e dailies são persistidos. É o destino final das operações autorizadas. |

Regra prática:

- “ferramenta do MCP”, “fila offline do MCP” e “configuração do MCP” referem-se
  à camada `mcp-gestao-tarefas`.
- “projeto”, “sprint”, “demanda”, “subtarefa” e “daily do Gestão de Tarefas”
  referem-se aos dados do aplicativo.
- Para diagnosticar, configurar ou alterar o próprio MCP, trabalhe no checkout
  `mcp-gestao-tarefas` e **não** use as ferramentas para gravar demandas ou
  dailies apenas porque houve mudança no código.
- Para diagnosticar ou alterar uma tela, rota ou regra de negócio do aplicativo,
  trate isso como trabalho no **Gestão de Tarefas**, não como trabalho no MCP.
- Se a intenção do usuário for apenas reportar o que fez, não registre nada no
  aplicativo; registrar daily/demanda/subtarefa exige pedido ou protocolo
  autorizado.

## Quando usar

Use esta skill sempre que o usuário:

- pedir para criar, consultar ou atualizar **demandas** ou **subtarefas**;
- mencionar **sprints**, **projetos** ou o sistema Gestão de Tarefas;
- pedir para **preencher ou registrar a daily**;
- pedir ajuda sobre o uso ou o resultado das ferramentas do MCP;
- reportar erro de conexão, autenticação ou sincronização entre o MCP e o
  aplicativo.

Não use esta skill como autorização para registrar trabalho no aplicativo quando
o assunto for apenas desenvolvimento, configuração ou teste do próprio MCP.

## Regra de ouro: validar contexto antes de tudo

Antes de **qualquer** operação de leitura ou escrita de demandas/subtarefas:

1. Chame `obter_contexto_projeto` passando o `diretorio_path` do projeto atual.
2. Avalie o campo `mcp_ativo` do retorno: o contexto abaixo é do **projeto no
   aplicativo**, não do checkout do próprio MCP.

| `mcp_ativo` | Ação |
| --- | --- |
| `false` | Projeto externo, pessoal ou não identificado. **Não crie nem altere demandas.** Informe o usuário, de forma respeitosa, que o projeto não está vinculado ao sistema. |
| `true` | Prossiga usando o `projeto.id`, o nome do projeto no aplicativo e a `sprint_atual` detectada. |

```json
// obter_contexto_projeto — 1ª chamada de qualquer fluxo
{ "diretorio_path": "/home/dev/Work/projeto-x" }
```

## Prevenção de duplicações e poluição

1. **Consulte antes de criar** — chame `listar_demandas_ativas` com o
   `projeto_id` atual antes de propor a criação de qualquer demanda.
2. **Prefira subtarefas** — tarefa técnica ligada a demanda já existente
   (ex.: "Ajustes nas telas", "Correções gerais", "Implementação de módulo")
   vira **subtarefa** via `criar_subtarefa`.
3. **Crie uma demanda nova** (`criar_demanda`) apenas quando:
   - tratar-se de nova funcionalidade ou iniciativa de escopo separado;
   - o usuário solicitar expressamente a criação de uma nova demanda.

## Padrões de demanda (`criar_demanda` / `atualizar_demanda`)

| Campo | Padrão |
| --- | --- |
| `titulo` | Claro, conciso e semântico (ex.: `feat(auth): adiciona login sso`, `fix(ui): corrige overflow na listagem`). |
| `descricao` | HTML estruturado: `<p>`, `<ul>`, `<li>`, `<strong>`, `<code>`. Texto simples é convertido automaticamente. |
| `data_limite` | Obrigatória, `YYYY-MM-DD`. Padrão: data de fim da sprint ativa ou data limite acordada. |
| `sprint_id` | Sempre a sprint ativa do projeto (`sprint_atual.id`). |
| `responsavel_id` | ID do colaborador que desenvolve (identificado no contexto ou nas demandas ativas). |
| `prioridade` | `'Alta'`, `'Média'` ou `'Baixa'`. |
| `impacto` | `'alto'`, `'medio'` ou `'baixo'`. |
| `status` | `para_fazer` \| `fazendo` \| `em_teste` \| `homologacao` \| `concluida` \| `cancelada` \| `impedimento`. |

```json
// criar_demanda
{
  "projeto_id": 12,
  "titulo": "feat(auth): adiciona login sso",
  "descricao": "<p>Implementar autenticação SSO no portal.</p><ul><li>Integrar provedor de identidade</li><li>Mapear permissões</li></ul>",
  "prioridade": "Alta",
  "impacto": "alto",
  "responsavel_id": 7,
  "sprint_id": 34,
  "data_limite": "2026-09-30"
}
```

## Padrões de subtarefas (`criar_subtarefa` / `atualizar_subtarefa` / `concluir_subtarefas`)

- **Granularidade:** cada subtarefa descreve um incremento técnico atômico
  e verificável.
- **Status:** `pendente` \| `fazendo` \| `concluida` \| `cancelada`.
- **Ciclo de vida:** crie a subtarefa no início da atividade e conclua ao
  finalizar as implementações:

```json
// concluir_subtarefas — múltiplos IDs em lote
{ "subtarefa_ids": [1609, 1610] }

// concluir_subtarefas — todas as pendentes de uma demanda
{ "demanda_id": 10065 }

// atualizar_subtarefa — uma única subtarefa
{ "subtarefa_id": 1609, "status": "concluida" }
```

## Daily (`rascunho_daily` → `criar_daily`)

Quando o usuário precisar preencher a daily (normalmente ao final do dia):

1. **Confirme a data e o horário** (ex.: "a daily foi às 17h"). Sem
   informação, use o dia atual até o momento da conversa.
2. Chame `rascunho_daily` passando `data` e a janela `hora_inicio`/`hora_fim`.
   O rascunho combina as sugestões obtidas pelo MCP do aplicativo com os
   repositórios git movimentados em `DAILY_SCAN_DIRS` — ele **não grava nada**.
3. **Revise o rascunho com o usuário:** ajuste `ontem`/`hoje`, confirme as
   observações (atividade por repositório) e os impedimentos.
4. Chame `criar_daily` com os itens revisados. Se já existir daily para a
   data, a ferramenta retorna o id e o resumo da existente, sem criar duplicata.

```json
// rascunho_daily
{ "data": "2026-09-20", "hora_inicio": "08:00", "hora_fim": "17:00" }
```

## Operação offline e resiliência

- Se a intranet da Prefeitura / servidor do aplicativo estiver inacessível, as
  ferramentas do MCP registram as operações automaticamente na fila offline
  local (`~/.gestao-tarefas-mcp/queue.sqlite`). Essa fila pertence ao MCP e não
  ao banco de dados do aplicativo.
- **Nunca** reexecute a mesma chamada em loop após erro de rede — o MCP
  gerencia o armazenamento local seguro.
- Com a conectividade restabelecida, execute `sincronizar_fila_offline` para
  enviar as requisições pendentes.

## Autenticação

- O MCP renova sessões web e tokens do aplicativo automaticamente, de forma
  transparente, quando as credenciais estiverem salvas.
- Em erro de autenticação persistente, ou se o usuário informar novas
  credenciais, utilize `renovar_sessao` com `email` e `password`.

## Referência rápida

| Ferramenta | Uso |
| --- | --- |
| `obter_contexto_projeto` | Valida o contexto e a atividade do MCP no diretório (sempre a 1ª chamada). |
| `listar_projetos` / `listar_sprints` | Listam projetos e sprints disponíveis no aplicativo. |
| `listar_demandas_ativas` | Demandas abertas ou em andamento de um projeto do aplicativo. |
| `obter_detalhes_demanda` | Detalhes, subtarefas e responsáveis de uma demanda. |
| `criar_demanda` / `atualizar_demanda` | Criam e alteram demandas. |
| `associar_demanda_sprint` | Vincula uma demanda a uma sprint. |
| `criar_subtarefa` / `atualizar_subtarefa` / `concluir_subtarefas` | Ciclo de vida das subtarefas. |
| `rascunho_daily` / `criar_daily` | Montam o rascunho e registram a daily revisada. |
| `verificar_status_conexao` | Estado da API do aplicativo, validade do token e fila offline do MCP. |
| `sincronizar_fila_offline` | Envia a fila offline do MCP ao aplicativo. |
| `renovar_sessao` | Renova a sessão de autenticação. |
