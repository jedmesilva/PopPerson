---
name: Diagnóstico de deployment externo
description: Como validar serviços publicados fora do runtime do Replit quando não há logs ou tokens de gerenciamento disponíveis.
---

Quando o backend e o frontend são publicados em Railway/Vercel, o runtime do Replit não fornece necessariamente logs de deployment nem capacidade de republicação. A validação deve separar saúde pública, estado persistido e comportamento do cliente.

**Why:** A ausência de logs do Replit não indica que o serviço externo esteja indisponível, e um preview local saudável não prova que a versão pública já recebeu a correção.

**How to apply:** Verifique endpoints públicos, consultas somente leitura no banco configurado e o preview local; informe explicitamente quando a correção ainda depender de uma publicação externa.

Para serviços fora do Replit, não dependa de `ReplitConnectors` ou de `REPLIT_DOMAINS` para o boot. Use credenciais Stripe e URL pública fornecidas pelo próprio ambiente externo, mantendo a inicialização de pagamentos incapaz de derrubar o servidor inteiro.

**Why:** O SDK de conectores exige identidade do Replit, que não existe no Railway/Vercel; uma exceção antes de `server.listen()` transforma uma configuração ausente em indisponibilidade total.

**How to apply:** Configure `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_BASE_URL` no serviço externo; deixe o endpoint de pagamentos retornar indisponibilidade explícita enquanto o Stripe não estiver configurado, mas mantenha healthchecks e demais rotas ativos.