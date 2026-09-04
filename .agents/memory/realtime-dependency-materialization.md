---
name: Materialização de dependências realtime
description: Particularidade do workspace quando uma dependência declarada no lockfile ainda não está disponível em node_modules.
---

Uma dependência realtime pode estar corretamente declarada no pacote e no lockfile, mas faltar no `node_modules` após mudanças importadas; nesse caso o build falha com erro de resolução mesmo sem haver erro de código.

**Why:** o workspace pode ser restaurado com o lockfile atualizado, porém com a instalação física incompleta para novos pacotes.

**How to apply:** confirme primeiro `package.json` e lockfile; se ambos já contêm o pacote, execute a instalação do workspace para materializar os links antes de alterar o código ou a versão.