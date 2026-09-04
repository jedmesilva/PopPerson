---
name: HUD de ações
description: Regra de consistência e desempenho para a pill do header e a fila de ações do InstaPop.
---

A pill do header e o modal de ações devem consumir a mesma representação normalizada de cada ação: emoji, nome do nível, alvo, modo e progresso. O emoji deve ser renderizado em um único elemento visual, nunca incluído também no texto do nível.

**Why:** A duplicação de fontes de exibição fez a lista mostrar dois emojis e a atualização contínua do componente inteiro deixou o HUD pesado durante ações longas.

**How to apply:** Centralize a transformação dos dados de fila/ações ativas e atualize apenas o estado temporal necessário em um intervalo moderado; preserve o loop de animação do canvas separado da renderização do React.