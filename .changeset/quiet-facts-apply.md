---
'@krafteq/infraglue': minor
---

Add `ig apply --allow-empty` to apply workspaces even when their plan shows no changes. Useful when a program has effects the provider preview cannot detect (e.g. writing facts to Vault outside a tracked resource).
