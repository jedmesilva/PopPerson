---
name: Imported artifact workflow registration
description: Environment behavior to account for when bootstrapping imported Replit monorepos with artifact metadata.
---

Imported repositories can contain valid `.replit-artifact/artifact.toml` files while the runtime has no registered artifact catalog entries or managed workflows. In that case, artifact-name restarts and artifact presentation fail even though the services can run.

**Why:** The imported project may be structurally ready but not registered in the current workspace runtime, so relying on metadata-only workflow names can leave the app stopped or make preview verification misleading.

**How to apply:** Check the live workflow/artifact inventory before restarting or presenting. If the inventory is empty, configure the smallest explicit frontend and backend workflows with the required ports and environment variables, and document their actual names. The workflow configurator has no environment-map field, so inline required values such as PORT and BASE_PATH in the command.