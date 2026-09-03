---
name: Efeitos em células móveis
description: Regra para sincronizar efeitos do canvas com células cujo tamanho e posição mudam durante a animação.
---

Efeitos visuais ligados a uma célula precisam resolver posição e raio a cada frame a partir do círculo animado atual. Coordenadas capturadas no momento do disparo fazem o projétil ou impacto ficar preso quando o layout reposiciona ou redimensiona a célula.

**Why:** o layout do canvas move as células enquanto os efeitos ainda estão em voo ou expansão; um endpoint estático cria a aparência de que o alvo morreu longe da bala.

**How to apply:** mantenha os pontos iniciais do efeito estáveis para preservar o arco, mas recalcule o endpoint, o controle da curva e o raio visual usando a célula atual durante o desenho.

Quando várias ações compartilham o canvas, o limite de projéteis precisa ser distribuído de forma justa entre emissores. Nunca avance o contador visual de uma ação apenas porque o limite global está cheio; isso descarta silenciosamente as ações que chegaram depois.

**Why:** uma ação longa ou intensa pode ocupar todos os slots e fazer ações posteriores parecerem inexistentes, mesmo estando persistidas e sendo resolvidas pelo servidor.

**How to apply:** use escalonamento round-robin entre emissores e só consuma um disparo quando ele foi desenhado ou quando seu alvo está deliberadamente fora do filtro.