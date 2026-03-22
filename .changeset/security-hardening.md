---
'@krafteq/infraglue': patch
---

Security hardening: prototype pollution prevention in dotenv parser, path traversal validation for env names/workspace globs/injection paths/depends_on/backend files, HCL injection prevention via backend_type validation, restrictive file permissions (0o600) on state and temp files, safer JSON parsing in Terraform provider, and shell injection fix in Pulumi config set (values with special characters like @^& are now passed via execFile instead of shell interpolation).
