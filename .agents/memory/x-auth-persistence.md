---
name: Persistência de auth X
description: Verificação da diferença entre o schema de autenticação importado e as tabelas reais do banco.
---

O login X precisa de duas camadas persistentes: `users` para a identidade do provedor e `auth_sessions` para sessões autenticadas com hash do token, expiração e revogação. `anonymous_sessions` é uma sessão separada para visitantes e pode ser vinculada ao usuário após o callback.

**Why:** Em imports de aplicações, os arquivos TypeScript do schema e as rotas de auth podem existir antes de as tabelas terem sido aplicadas no banco de desenvolvimento; compilar não comprova persistência.

**How to apply:** Antes de validar o callback X, confira `information_schema`, FKs, índices e RLS no banco de desenvolvimento. Teste `/api/auth/me` sem sessão e `/api/auth/x/start` sem revelar tokens; só espere usuários e sessões autenticadas após um callback OAuth real.