---
name: Entrada durante OAuth
description: Regra de produto para combinar conexão com X e entrada automática na disputa.
---

A conexão com X e a entrada na disputa devem ser apresentadas como uma única ação. O aceite dos termos acontece antes do redirecionamento, e uma intenção temporária acompanha o retorno do OAuth. Quando a sessão autenticada volta, a inscrição deve ser enviada automaticamente se categoria e localização estiverem completas; caso contrário, a interface deve pedir apenas o complemento que falta.

**Why:** Separar visualmente autenticação e participação fazia o usuário repetir uma decisão que já havia tomado e deixava o vínculo com o player implícito.

**How to apply:** Mantenha a separação entre autenticação e inscrição no backend para preservar validação e idempotência, mas trate-as como um fluxo único na interface. Expire ou limpe a intenção se o OAuth for cancelado ou se o usuário já for player.