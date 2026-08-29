---
name: Registro de workflows importados
description: Comportamento do ambiente ao iniciar artefatos importados com metadados de serviço.
---

Artefatos importados podem conter um `.replit-artifact/artifact.toml` válido sem aparecerem no catálogo de artefatos ou na lista de workflows do workspace. Mesmo após o registro, a porta declarada em `localPort` precisa coincidir com a porta injetada no workflow; caso contrário, o serviço pode responder diretamente e o preview retornar 502.

**Why:** O arquivo de metadados do repositório não garante que o runtime atual tenha registrado ou iniciado o serviço.

**How to apply:** Antes de reiniciar ou capturar um preview, consulte o inventário de workflows, confirme os nomes gerenciados e compare `localPort` e `services.env.PORT` com a porta efetiva do workflow. Imports podem manter workflows legados com os mesmos processos; pare-os antes de iniciar os gerenciados para evitar disputa de portas. Preserve os comandos e as variáveis exigidas pelo projeto.