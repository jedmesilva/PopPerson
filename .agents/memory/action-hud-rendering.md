---
name: HUD de ações
description: Regra de consistência e desempenho para a pill do header e a fila de ações do InstaPop.
---

A pill do header e o modal de ações devem consumir a mesma representação normalizada de cada ação: emoji, nome do nível, alvo, modo e progresso. O emoji deve ser renderizado em um único elemento visual, nunca incluído também no texto do nível.

**Why:** A duplicação de fontes de exibição fez a lista mostrar dois emojis e a atualização contínua do componente inteiro deixou o HUD pesado durante ações longas.

**How to apply:** Centralize a transformação dos dados de fila/ações ativas e atualize apenas o estado temporal necessário em um intervalo moderado; preserve o loop de animação do canvas separado da renderização do React.

O progresso de uma ação deve ser monotônico durante a sessão: eventos `action:hit` e snapshots só podem manter ou aumentar `hitCount`; `action:resolved` precisa retirar a ação tanto da lista ativa quanto da fila.

**Why:** Eventos realtime e snapshots são entregues por caminhos independentes e podem chegar em ordens diferentes; aceitar um valor antigo deixa a porcentagem visual voltar ou mantém uma ação concluída presa no HUD.

**How to apply:** Ao reconciliar qualquer fonte, use o maior progresso conhecido limitado ao total da ação e limpe todas as referências locais quando a resolução for confirmada.