---
name: Badges dentro de círculos
description: Regra geométrica para badges desenhados sobre células circulares do canvas.
---

Badges ancorados na lateral de uma célula circular precisam calcular a borda do círculo na altura real do badge. `centerX - radius` só representa a borda no equador; acima ou abaixo dele, essa fórmula coloca o badge fora da célula.

**Why:** o canvas usa círculos que mudam de tamanho com o zoom, enquanto os badges mantêm dimensões legíveis em pixels. A diferença fica visível principalmente em células grandes ou muito ampliadas.

**How to apply:** converta o tamanho fixo do badge para coordenadas do mundo, considere metade da altura do badge ao calcular a distância vertical e derive a meia-largura pela interseção circular antes de posicionar o centro do badge.