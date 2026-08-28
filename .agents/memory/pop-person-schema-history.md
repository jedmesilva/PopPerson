---
name: PopPerson schema history
description: Historical Drizzle migration differences between the imported repository and its already-provisioned database.
---

The provisioned development database and the current Drizzle schema may already contain the category-based people model even when the checked-in migration journal still reflects the older role-based model. Drizzle migration generation can request interactive column-rename decisions and fails in the non-TTY agent shell.

**Why:** Forcing the rename detection can drop or misname existing data, while `drizzle-kit push` can correctly confirm that the live development schema already matches the current TypeScript schema.

**How to apply:** Before generating historical migrations, compare the live schema and current schema with read-only queries. Prefer a reviewed, explicit migration plan for fresh environments rather than accepting automated rename prompts blindly.