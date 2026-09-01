---
name: Ciclo da localização de acesso
description: Regra para resolver, registrar e associar a localização de acesso sem acoplá-la a fluxos de inscrição.
---

A localização de acesso deve ser resolvida no primeiro carregamento da plataforma, depois que a sessão anônima existir. O evento deve ser registrado para anônimos e, quando houver autenticação, a última localização deve ser associada ao usuário em campos próprios, sem reutilizar ou sobrescrever a localização declarada no perfil externo. A origem deve ser passiva, baseada no IP recebido na borda/servidor, sem solicitar permissão de geolocalização ao navegador; país é o nível confiável e cidade é apenas estimativa.

**Por que:** a inscrição de player é uma ação posterior e não deve ser responsável por descobrir a localização. Além disso, respostas cacheadas podem impedir o registro e a atualização da conta. A geolocalização do navegador gera rejeição frequente dos visitantes, enquanto plataformas de analytics usam IP; múltiplos provedores reduzem falhas pontuais, mas não transformam cidade em dado exato.

**Como aplicar:** mantenha a chamada de localização fora do modal, use resposta `no-store` quando a chamada tiver efeito de registro/associação, normalize headers/IPs na borda confiável, use consenso/fallback de provedores para país e trate `source: local` como comportamento esperado no Preview, onde o servidor recebe um IP privado.