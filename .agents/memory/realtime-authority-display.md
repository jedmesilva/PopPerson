---
name: Autoridade realtime versus exibição
description: Regra para reconciliar snapshots autoritativos com animações de hits em andamento no PopPerson.
---

Durante uma ação ativa, mantenha o dataset autoritativo recebido do servidor separado do valor exibido. Um snapshot pode atualizar células sem efeitos pendentes, mas a célula-alvo deve avançar visualmente apenas quando cada hit confirmado for comprometido; ao terminar a ação, o snapshot final pode reconciliar o restante.

**Why:** snapshots podem chegar à frente da animação local ou depois de uma reconexão. Aplicá-los diretamente na célula-alvo faz o valor mudar sem impacto, enquanto ignorá-los por completo pode deixar o cliente divergente após a ação.

**How to apply:** deduplicate efeitos por `actionId + hitIndex`, use `hitAt` autoritativo para agendar e preserve projéteis/impactos já iniciados até sua conclusão visual.