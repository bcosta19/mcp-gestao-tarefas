# Changelog

## [1.1.0](https://github.com/bcosta19/mcp-gestao-tarefas/compare/v1.0.0...v1.1.0) (2026-08-22)


### Features

* adiciona ferramenta atualizar_demanda para edicao de demandas ([30c424a](https://github.com/bcosta19/mcp-gestao-tarefas/commit/30c424a8f63fbcb170f0bb48f16f9acb87bee04c))
* adiciona ferramenta concluir_subtarefas e suporte a atualizacao em lote de subtarefas ([a4378cc](https://github.com/bcosta19/mcp-gestao-tarefas/commit/a4378cc8ef5dbb7ad8afeafebe3d2ac60d5fa0cf))
* adiciona persistencia local de sprint com resolucao por intervalo e fallback offline ([6729f4d](https://github.com/bcosta19/mcp-gestao-tarefas/commit/6729f4db30c7ab8114bf96499b6b0543fc4d2976))
* adiciona renovacao automatica e persistencia de sessao web/token com credenciais salvas ([9803d46](https://github.com/bcosta19/mcp-gestao-tarefas/commit/9803d4606b72e2ec982f34f05e742f578314d484))
* adiciona servidor MCP de gestao de tarefas ([b20f78f](https://github.com/bcosta19/mcp-gestao-tarefas/commit/b20f78fffe59dfd96616e06bedfe39a2fc3d6408))
* adiciona skill gestao-tarefas e injecao automatica para Codex e Antigravity ([129c275](https://github.com/bcosta19/mcp-gestao-tarefas/commit/129c27533275250dea4ca4f7c01d8e0be6ba60fe))
* adiciona suporte a configuracao de MCP e Skills para Claude Code ([23e2ab9](https://github.com/bcosta19/mcp-gestao-tarefas/commit/23e2ab9157d49274bd17d526acf06bbcdcf30bd3))
* adiciona suporte ao harness Pi ([ff3aec1](https://github.com/bcosta19/mcp-gestao-tarefas/commit/ff3aec177c23945a06513979e822569a67abf8b3))
* ajusta atualizar_demanda com projeto_id obrigatorio, token CSRF e descricao rich text ([aa1dfe2](https://github.com/bcosta19/mcp-gestao-tarefas/commit/aa1dfe235b27f76bc22213c9d20d3f57993ce186))
* automatiza configuracao do MCP para Codex e OpenCode ([2429277](https://github.com/bcosta19/mcp-gestao-tarefas/commit/2429277f18ec5095dab431e8e5384138688d42bd))
* define URL padrao da Codemar no prompt do setup CLI ([ef6ee7e](https://github.com/bcosta19/mcp-gestao-tarefas/commit/ef6ee7e4cd05f028cdf3701c3f0b0e9535f5a1cb))
* mantem projetos da Prefeitura ativos e bloqueia apenas externos ou nao identificados ([6847d55](https://github.com/bcosta19/mcp-gestao-tarefas/commit/6847d55a7c60e65052c5734f4a1eefa48cff5f07))
* otimiza e formata saidas JSON para melhor interpretacao e economia de contexto de LLMs ([8b8aaeb](https://github.com/bcosta19/mcp-gestao-tarefas/commit/8b8aaebba3efba2d57ebef5c07fb5d86048d3a57))


### Bug Fixes

* **subtarefas:** aciona rota POST /subtarefas/:id/alterar-status ao atualizar status de subtarefas ([b3f196f](https://github.com/bcosta19/mcp-gestao-tarefas/commit/b3f196fa0d9e835af3a34d8827b0e673d41e5c99))


### Performance Improvements

* melhora concorrencia e desempenho do MCP ([707c1a8](https://github.com/bcosta19/mcp-gestao-tarefas/commit/707c1a86bbcc4781257e98ac37e1c095e13492fe))


### Documentation

* adiciona documento de arquitetura ([21ab381](https://github.com/bcosta19/mcp-gestao-tarefas/commit/21ab381a77b6991dd998111a47cb621d185d5fbc))
* simplifica documentacao do projeto ([727a6e0](https://github.com/bcosta19/mcp-gestao-tarefas/commit/727a6e0630101d713fabde4919df6167e40699a8))


### Miscellaneous

* adiciona script de update e configuracao do release-please ([4b9e78d](https://github.com/bcosta19/mcp-gestao-tarefas/commit/4b9e78d3581f8db0677ceba9eb81eee7668fe409))
* integra historico inicial do repositorio ([a6e2c9f](https://github.com/bcosta19/mcp-gestao-tarefas/commit/a6e2c9f7035552d3e9c01124ca6ab3732fb1d22f))
