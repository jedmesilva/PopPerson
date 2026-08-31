---
name: Provedor de busca geográfica
description: Decisão sobre a API usada para pesquisar cidades e preencher região e país.
---

A busca mundial de cidades usa o Open-Meteo Geocoding API, com a requisição mediada pelo backend.

**Why:** O usuário confirmou que a solução funciona e atende à seleção de cidade com estado/região e país.

**How to apply:** Preserve a mediação pelo backend para controlar cache, limites de uso e o formato estável entregue ao frontend.