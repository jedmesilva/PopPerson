---
name: Contrato de perfil autenticado
description: Regra para separar dados vindos do provedor X dos metadados da conta InstaPop.
---

O perfil autenticado deve combinar os dados sincronizados do X com metadados próprios persistidos pelo InstaPop. A data de cadastro deve ser lida de `users.created_at`, serializada como ISO 8601 e não tratada como parte do perfil retornado pelo provedor.

**Why:** o X fornece identidade e perfil conectado, mas não representa necessariamente a data em que a conta foi criada no InstaPop.

**How to apply:** ao expandir o perfil autenticado, derive campos de conta do banco e mantenha os campos do X limitados à identidade sincronizada.