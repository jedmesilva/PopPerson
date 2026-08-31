---
name: Ciclo da localização de acesso
description: Regra para resolver, registrar e associar a localização de acesso sem acoplá-la a fluxos de inscrição.
---

A localização de acesso deve ser resolvida no primeiro carregamento da plataforma, depois que a sessão anônima existir. O evento deve ser registrado para anônimos e, quando houver autenticação, a última localização deve ser associada ao usuário em campos próprios, sem reutilizar ou sobrescrever a localização declarada no perfil externo.

**Por que:** a inscrição de player é uma ação posterior e não deve ser responsável por descobrir a localização. Além disso, respostas cacheadas podem impedir o registro e a atualização da conta.

**Como aplicar:** mantenha a chamada de localização fora do modal, use resposta `no-store` quando a chamada tiver efeito de registro/associação e trate `source: local` como comportamento esperado no Preview, onde o servidor recebe um IP privado.