---
name: Replay após retenção do outbox
description: Regra para lidar com lacunas de sequência criadas pela retenção do outbox durante conexões WebSocket ativas.
---

Quando a sequência do outbox é global e eventos antigos podem ser removidos, o gateway deve detectar se o primeiro evento retornado após seu cursor é maior que cursor + 1. Nesse caso, envie um snapshot de recuperação e avance o cursor para a sequência capturada do snapshot, em vez de entregar eventos parcialmente.

**Why:** Uma conexão já estabelecida pode receber um evento posterior a uma lacuna de retenção; verificar somente o evento mais antigo ainda armazenado não detecta essa situação e faz o cliente acusar gap repetidamente.

**How to apply:** Use a mesma regra tanto no replay solicitado por uma conexão quanto no polling/broadcast contínuo do gateway. Capture a sequência antes do snapshot para que eventos posteriores permaneçam elegíveis no próximo ciclo.