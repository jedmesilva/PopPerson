---
name: Efeitos em células móveis
description: Regra para sincronizar efeitos do canvas com células cujo tamanho e posição mudam durante a animação.
---

Efeitos visuais ligados a uma célula precisam resolver posição e raio a cada frame a partir do círculo animado atual. Coordenadas capturadas no momento do disparo fazem o projétil ou impacto ficar preso quando o layout reposiciona ou redimensiona a célula.

**Why:** o layout do canvas move as células enquanto os efeitos ainda estão em voo ou expansão; um endpoint estático cria a aparência de que o alvo morreu longe da bala.

**How to apply:** mantenha os pontos iniciais do efeito estáveis para preservar o arco, mas recalcule o endpoint, o controle da curva e o raio visual usando a célula atual durante o desenho.