---
name: Workflow restart after builds
description: Runtime workflows keep the bundle loaded at process start; a later build alone does not update the running server.
---

The API workflow must be restarted after rebuilding code that is executed by the long-lived server process.

**Why:** A build can successfully replace the bundle on disk while the already-running process continues using the previous bundle, which can make a correct fix appear ineffective.

**How to apply:** After backend or frontend run-command/code changes, restart the relevant workflow, then inspect fresh logs before testing behavior.