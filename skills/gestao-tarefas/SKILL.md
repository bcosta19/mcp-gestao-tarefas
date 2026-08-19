---
name: gestao-tarefas
description: >
  Guia obrigatório de boas práticas e protocolo para integração com o servidor MCP Gestão de Tarefas.
  Use sempre que for interagir com demandas, subtarefas, sprints ou projetos da Prefeitura de Maricá / Codemar.
---

# Protocolo e Boas Práticas do MCP Gestão de Tarefas

Este documento orienta o agente sobre as regras de negócio, tomada de decisão e sequência correta de chamadas das ferramentas do servidor MCP **Gestão de Tarefas**.

## 1. Regra de Ouro: Detecção de Contexto Obrigatória

Antes de realizar **qualquer** operação de leitura ou escrita de demandas/subtarefas:

1. Chame sempre `obter_contexto_projeto` passando o diretório do projeto (`diretorio_path`).
2. Avalie o retorno do campo `mcp_ativo`:
   - Se `mcp_ativo === false`: O projeto atual é externo, pessoal ou não identificado. **NÃO crie ou altere demandas no Gestão de Tarefas.** Informe o usuário de forma respeitosa que o projeto não está vinculado ao sistema.
   - Se `mcp_ativo === true`: Prossiga utilizando o `projeto.id`, o nome do projeto e a `sprint_atual` detectada.

## 2. Prevenção de Duplicações e Poluição

Evite criar demandas repetidas ou rascunhos sem necessidade:

1. **Consulta prévia:** Antes de propor criar uma nova demanda, chame `listar_demandas_ativas` com o `projeto_id` do projeto atual para consultar as demandas em andamento.
2. **Preferência por Subtarefas:**
   - Se o desenvolvedor estiver executando uma tarefa técnica referente a uma demanda já existente (ex: "Ajustes nas telas", "Correções gerais", "Implementação de módulo"), crie **subtarefas** vinculadas a essa demanda via `criar_subtarefa`.
   - Crie uma **nova demanda** (`criar_demanda`) **apenas** quando:
     - Tratar-se de uma nova funcionalidade / iniciativa de escopo separado;
     - O usuário solicitar expressamente a criação de uma nova demanda.

## 3. Padrões para Criação e Atualização de Demandas

Ao usar `criar_demanda` ou `atualizar_demanda`:

- **Título:** Claro, conciso e semântico (ex: `feat(auth): adiciona login sso`, `fix(ui): corrige overflow na listagem`).
- **Descrição (`descricao`):** Formate sempre em HTML estruturado (`<p>`, `<ul>`, `<li>`, `<strong>`, `<code>`).
- **Data Limite (`data_limite`):** Obrigatória no formato `YYYY-MM-DD`. Por padrão, utilize a data de fim da sprint ativa ou a data limite acordada.
- **Sprint (`sprint_id`):** Vincule à sprint ativa do projeto (`sprint_atual.id`).
- **Responsável (`responsavel_id`):** Atribua ao ID do colaborador que está desenvolvendo (identificado no contexto ou nas demandas ativas).
- **Prioridade e Impacto:** Use `'Alta'`, `'Média'` ou `'Baixa'` para prioridade, e `'alto'`, `'medio'` ou `'baixo'` para impacto.

## 4. Padrões para Subtarefas

Ao usar `criar_subtarefa` ou `atualizar_subtarefa`:

- **Granularidade:** Cada subtarefa deve descrever um incremento técnico atômico e verificável.
- **Ciclo de vida:**
  - Crie a subtarefa no início da atividade (`criar_subtarefa`).
  - Ao concluir a implementação e os testes, marque como concluída com `atualizar_subtarefa` (`status: "concluida"`).

## 5. Operação Offline e Resiliência

- Se a intranet da Prefeitura / servidor estiver inacessível, as ferramentas registrarão as operações na fila offline local automaticamente (`~/.gestao-tarefas-mcp/queue.sqlite`).
- Nunca tente reexecutar a mesma chamada em loop caso haja erro de rede. O MCP gerencia o armazenamento local seguro.
- Quando a conectividade for restabelecida, execute `sincronizar_fila_offline` para enviar as requisições pendentes.
