---
'@krafteq/infraglue': patch
---

Security hardening: prototype pollution prevention in dotenv parser, path traversal validation for env names/workspace globs/injection paths/depends_on/backend files, HCL injection prevention via backend_type validation, restrictive file permissions (0o600) on state and temp files, and safer JSON parsing in Terraform provider.
