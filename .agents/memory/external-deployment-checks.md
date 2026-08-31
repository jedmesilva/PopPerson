---
name: Diagnóstico de deployment externo
description: Como validar serviços publicados fora do runtime do Replit quando não há logs ou tokens de gerenciamento disponíveis.
---

Quando o backend e o frontend são publicados em Railway/Vercel, o runtime do Replit não fornece necessariamente logs de deployment nem capacidade de republicação. A validação deve separar saúde pública, estado persistido e comportamento do cliente.

**Why:** A ausência de logs do Replit não indica que o serviço externo esteja indisponível, e um preview local saudável não prova que a versão pública já recebeu a correção.

**How to apply:** Verifique endpoints públicos, consultas somente leitura no banco configurado e o preview local; informe explicitamente quando a correção ainda depender de uma publicação externa.