---
name: Workflow restart after builds
description: Runtime workflows keep the bundle loaded at process start; a later build alone does not update the running server.
---

The API workflow must be restarted after rebuilding code that is executed by the long-lived server process.

**Why:** A build can successfully replace the bundle on disk while the already-running process continues using the previous bundle, which can make a correct fix appear ineffective.

**How to apply:** After backend or frontend run-command/code changes, restart the relevant workflow, then inspect fresh logs before testing behavior.

If a restart fails with “port already in use,” an older artifact process may still own the port even when the workflow is marked failed. Verify the listener and its command before terminating anything, and stop only the confirmed process tree for that artifact.

**Why:** a failed managed restart did not reclaim the still-running Vite process, so each retry collided with the same listener.

**How to apply:** Check the port owner with `lsof` and confirm its command with `ps`; restart only after the stale artifact listener is gone.