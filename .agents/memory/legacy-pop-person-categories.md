---
name: Categorias legadas do InstaPop
description: Decisão de compatibilidade do banco após remover categorias do cadastro e da exibição.
---

A coluna legada de categoria em `people` deve permanecer nullable para preservar dados históricos, mas não deve ser lida, validada, enviada ou exposta por nenhum fluxo ativo do InstaPop.

**Why:** Remover a obrigatoriedade permite novos jogadores sem categoria sem destruir registros antigos nem exigir uma migração destrutiva.

**How to apply:** Ao alterar cadastro, dataset ou contratos, trate categoria como dado histórico somente; não reintroduza joins, endpoints, componentes ou campos de API para ela.