---
name: Dedicated worker runtime
description: Runtime constraint for running the PopPerson action worker in this workspace.
---

The development action-worker workflow must run the compiled worker bundle rather than invoking `tsx` directly; `tsx` is not available in the API package runtime even though the repository has TypeScript tooling elsewhere.

**Why:** The first dedicated-worker workflow failed before opening because its script depended on a package-local `tsx` binary that was not installed.

**How to apply:** Keep the worker development command on the same build-then-run path as the API, and rebuild before restarting the worker after source changes.