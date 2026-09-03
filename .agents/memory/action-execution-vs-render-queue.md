---
name: Fila de execução versus renderização
description: Ações multiplayer devem ser iniciadas pelo servidor e exibidas pelo cliente sem confundir capacidade gráfica com autoridade do jogo.
---

A fila de ações é autoritativa no servidor: uma ação aceita fica `queued`, não altera a célula, e só passa a `running` em uma transação do worker que publica o evento de início. O cliente nunca envia o comando que inicia a ação nem aplica o efeito no banco.

**Why:** o navegador é um ambiente não confiável e pode fechar, atrasar ou adulterar comandos. Adiar ou aplicar efeitos por decisão do cliente permitiria divergência, fraude e ações pagas sem conclusão.

**How to apply:** o servidor deve reservar capacidade/fairness na fila, confirmar cada hit no banco e publicar eventos replayáveis; o cliente deve renderizar todo início recebido e usar um renderer GPU/batching/LOD para suportar volume sem descartar a ação lógica.