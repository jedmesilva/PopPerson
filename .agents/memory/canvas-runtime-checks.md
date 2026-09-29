---
name: Verificação runtime do canvas
description: Helpers novos usados no draw precisam ser exercitados no preview, não apenas pelo typecheck.
---

Funções chamadas pelo loop de desenho do canvas devem ser validadas em um preview real, porque a configuração atual pode não sinalizar referências ausentes durante o typecheck.

**Why:** um helper de posicionamento pode compilar e ainda interromper todo o render no primeiro frame quando o nome da função está incorreto ou a referência não existe.

**How to apply:** após mudanças no `draw`, rode typecheck/build e capture o preview; considere a tarefa incompleta se houver erro de runtime no overlay ou nos logs do navegador.