---
name: Piso de cobrança Stripe
description: Regra para manter preços de ações compatíveis com o mínimo de cobrança do Stripe em BRL.
---

O preço-base usado pelo dataset, pelo Checkout e pelo valor persistido da ação deve aplicar o mesmo piso técnico de cobrança do Stripe; não crie um valor diferente apenas no frontend.

**Why:** O Stripe rejeita valores BRL muito baixos depois de convertê-los para a moeda da conta, mesmo que o cálculo do jogo permita centavos.

**How to apply:** Se a moeda ou a conta Stripe mudar, revalide o piso no modo de teste e mantenha a regra centralizada no cálculo server-side que alimenta o dataset e a criação do Checkout.