---
name: Autoridade realtime versus exibição
description: Regra para reconciliar snapshots autoritativos com animações de hits em andamento no PopPerson.
---

Durante uma ação ativa, mantenha o dataset autoritativo recebido do servidor separado do valor exibido. O servidor publica a ação completa em `action:started`, não cada hit; o cliente agenda projéteis e impactos pelo relógio sincronizado. Um snapshot ou resolução final pode atualizar a autoridade sem interromper os efeitos locais.

**Why:** snapshots podem chegar à frente da animação local ou depois de uma reconexão. Aplicá-los diretamente na célula-alvo faz o valor mudar sem impacto, enquanto ignorá-los por completo pode deixar o cliente divergente após a ação.

**How to apply:** derive the local timeline from `executeAt`, `count`, `staggerMs`, and `duration`; update the displayed radius per local hit using `growthPerHit` and direction; deduplicate effects by `actionId + hitIndex`, and reconcile the final value from the server.

Após um POST de ação confirmado, o cliente pode iniciar um fallback visual local; se o evento resolvido chegar depois, ele deve reconciliar os valores autoritativos sem iniciar uma segunda animação.

**Why:** uma desconexão curta do WebSocket pode perder o único evento de resolução, fazendo uma ação persistida parecer desaparecer apesar de o banco ter sido atualizado.

**How to apply:** use uma chave local diferente da chave do evento realtime e ignore o fallback quando a ação já estiver ativa, preservando a resolução recebida do servidor.

Quando um snapshot de reconexão trouxer uma ação `running` sem o `action:started` correspondente, restaure a timeline visual uma única vez antes de continuar aceitando os hits confirmados pelo servidor.

**Why:** o snapshot recupera a autoridade e o HUD, mas não repete efeitos visuais perdidos; sem materializar a timeline, a ação pode continuar alterando o valor sem projéteis ou impactos na tela.

**How to apply:** o caminho comum que enfileira ações `running` deve chamar o mesmo materializador visual de `action:started`, protegido por `actionId` para não duplicar bursts.