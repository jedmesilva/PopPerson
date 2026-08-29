---
name: Registro de workflows importados
description: Comportamento do ambiente ao iniciar artefatos importados com metadados de serviço.
---

Artefatos importados podem conter um `.replit-artifact/artifact.toml` válido sem aparecerem no catálogo de artefatos ou na lista de workflows do workspace.

**Why:** O arquivo de metadados do repositório não garante que o runtime atual tenha registrado ou iniciado o serviço.

**How to apply:** Antes de reiniciar ou capturar um preview, consulte o inventário de workflows e, se necessário, configure os menores workflows explícitos para os serviços existentes, preservando os comandos e as variáveis exigidas pelo projeto.