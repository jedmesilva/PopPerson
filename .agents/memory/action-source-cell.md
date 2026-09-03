---
name: Origem visual da ação
description: Contrato entre autenticação, ações persistidas e a animação de projéteis no PopPerson.
---

A origem de uma ação autenticada é a célula ativa da pessoa vinculada ao usuário participante, não uma coordenada fixa do canvas. A ação deve persistir essa referência e expor um identificador visual estável para o cliente.

**Why:** a posição das células é calculada e animada no cliente; sem uma origem persistida, o efeito parece sair de um ponto aleatório e não representa quem enviou o ataque ou defesa.

**How to apply:** resolva a célula do participante no servidor ao criar a ação, devolva seu nome junto com a ação realtime e capture sua posição atual no instante de cada disparo. Mantenha o endpoint do alvo dinâmico enquanto o projétil voa; ações legadas sem origem precisam continuar sendo aceitas.