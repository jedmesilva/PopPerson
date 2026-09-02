---
name: Compatibilidade OpenAPI/Zod
description: Limitação do codegen Orval quando o schema OpenAPI usa format uri neste workspace.
---

Ao adicionar URLs ao OpenAPI, prefira `type: ["string", "null"]` com descrição em vez de `format: uri`, caso o codegen gere `zod.url()` e a versão efetivamente resolvida do Zod não exponha esse método.

**Why:** O workspace pode declarar imports de `zod/v4`, mas a resolução usada pelo código gerado pode apontar para um pacote Zod compatível apenas com a API antiga; o codegen termina, mas `typecheck:libs` falha.

**How to apply:** Depois de qualquer mudança no OpenAPI, execute o codegen e o `typecheck:libs`; se `format: uri` causar erro em `zod.url()`, remova o formato e mantenha a validação de URL na origem que constrói o valor.