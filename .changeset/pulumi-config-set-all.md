---
'@krafteq/infraglue': patch
---

Performance: use `pulumi config set-all` for bulk config injection instead of spawning a separate `pulumi config set` process per key. Reduces N process invocations to 1 when setting workspace config values.
