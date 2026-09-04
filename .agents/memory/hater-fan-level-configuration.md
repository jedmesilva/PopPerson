---
name: Configuração de níveis Hater/Fã
description: Regra durável para a configuração de ações e preservação dos dados legados.
---

Os novos fluxos de ação usam exclusivamente os tipos `hate` e `fan` e os níveis ativos associados a eles. Cada tipo mantém preço base atual e mínimo, e cada tipo deve ter exatamente dez níveis persistidos com nome, emoji e multiplicador.

**Why:** a configuração precisa ser editável pelo backend/banco sem reintroduzir itens na UI ou em novas ações, enquanto as tabelas antigas continuam preservadas para ações históricas.

**How to apply:** novas rotas, componentes e cálculos devem consultar `action_types`/`action_levels`; não usar `items` ou `item_action_rules` para configurar ou criar ações novas. A compatibilidade `atacar`/`defender` fica apenas como representação interna de realtime.