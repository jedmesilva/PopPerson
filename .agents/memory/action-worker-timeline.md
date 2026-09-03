---
name: Worker de timeline de ações
description: Regra para processar ações running e emitir hits realtime durante a execução.
---

Uma ação `running` deve ser processada pelo número de hits já devidos no seu timeline; `completesAt` só pode autorizar a conclusão, não adiar o processamento de todos os hits.

**Why:** Filtrar ações `running` por `completesAt` ou por um lease de recuperação faz o worker ignorar a janela ativa, deixando a ação presa e entregando apenas um resultado tardio.

**How to apply:** A cada ciclo, selecione a ação head de cada célula e compare `dueHitCountAt` com os hits persistidos. Persista e publique cada hit confirmado; finalize somente quando `isTimelineComplete` for verdadeiro.