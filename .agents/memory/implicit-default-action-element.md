---
name: Compatibilidade sem seleção de item
description: Decisão temporária para manter o envio de ações enquanto a interface escolhe apenas entre níveis de Hater e Fã.
---

A interface não expõe mais a escolha de item, mas o contrato atual de criação de ações ainda exige `elementId`. Até a migração desse contrato, o primeiro item configurado para o modo escolhido é usado internamente.

**Why:** remover o item da tela sem alterar a API permite entregar o novo fluxo visual sem quebrar as ações realtime existentes.

**How to apply:** qualquer alteração futura que remova essa compatibilidade deve atualizar o contrato OpenAPI, os tipos gerados, a validação da rota e o cálculo de preço antes de eliminar o elemento interno.