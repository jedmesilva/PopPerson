---
name: Modos de cliente OAuth do X
description: Regra do X OAuth 2.0 PKCE para clientes Web App confidenciais e clientes públicos.
---

Para o OAuth 2.0 Authorization Code com PKCE do X, um Web App é cliente confidencial: envia `Authorization: Basic base64(client_id:client_secret)` e não envia `client_id` no corpo da troca do token. Single Page App e Native App são clientes públicos: enviam `client_id` no corpo e não usam segredo.

**Why:** O X trata esses dois formatos como modos distintos; misturar Basic Auth com `client_id` no corpo pode fazer a troca do token falhar ou produzir diagnósticos ambíguos.

**How to apply:** Ao configurar o backend, alinhe o tipo escolhido no Developer Portal com a presença de `X_CLIENT_SECRET` e valide a resposta da troca do token sem registrar tokens.