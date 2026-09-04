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

A linha do tempo visual precisa ser determinística e o worker deve materializar os impactos em lotes: o HUD e os projéteis usam início, duração, intervalo e quantidade iguais, enquanto a célula permanece autorizada pelo servidor.

**Why:** A animação local podia terminar em segundos enquanto milhares de updates/notifications individuais mantinham os hits reais atrasados por minutos, criando uma divergência impossível de explicar para o usuário.

**How to apply:** Não introduza jitter de duração no projétil quando o progresso depende do relógio visual; no worker, agrupe updates da célula/sala, inserção de eventos e publicação realtime por lote.

Ao agrupar notificações PostgreSQL, cada payload individual ainda precisa respeitar o limite de tamanho do `NOTIFY`; agrupe a execução SQL, não todos os eventos em um único payload JSON.

**Why:** Um lote JSON com muitos impactos ultrapassou o limite do PostgreSQL, abortou a transação e deixou ações vencidas em `running`, fazendo o HUD ficar em 100% sem receber `action:resolved`.

**How to apply:** Publique os eventos individualmente a partir de uma lista JSON dentro de uma única consulta, e valide a recuperação de uma ação interrompida após reiniciar o worker.