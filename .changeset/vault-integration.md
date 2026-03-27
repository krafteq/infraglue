---
'@krafteq/infraglue': minor
---

feat: HashiCorp Vault secret interpolation in ig.yaml configs

Reference Vault KV v2 secrets directly in `vars`, `backend_config`, and other config fields using `${vault:secret/data/path#field}` syntax.

- **Auth**: token resolution via `VAULT_TOKEN` → `~/.vault-token` → JWT auth (`VAULT_ID_TOKEN`)
- **Config**: optional `vault` block in root ig.yaml for address and role (env var fallbacks)
- **Caching**: multiple fields from the same secret path fetch once per run
- **No dependencies**: uses Node.js built-in `fetch` for Vault HTTP API
