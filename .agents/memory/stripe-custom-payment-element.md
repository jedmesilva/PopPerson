---
name: Checkout customizado Stripe
description: Decisão de usar PaymentIntent e PaymentElement em vez do Checkout Embedded para manter a UI e o fluxo de conclusão sob controle.
---

O checkout de ações do InstaPop usa uma UI própria com `PaymentElement`; o servidor cria um `PaymentIntent` idempotente e o webhook `payment_intent.succeeded` cria a ação.

**Why:** O Stripe mudou repetidamente a API do Checkout Embedded (`embedded`, `embedded_page`, métodos de montagem e regras de `return_url`), e o modo embedded podia navegar a página mesmo quando o produto precisava de uma experiência realtime sem reload.

**How to apply:** Mantenha redirects desabilitados no PaymentIntent (`automatic_payment_methods.allow_redirects: "never"`), confirme com `redirect: "if_required"` no cliente e trate o webhook como a única confirmação que libera a ação.