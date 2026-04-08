---
'@krafteq/infraglue': minor
---

Reserve exit code 2 exclusively for "changes detected" in plan/apply/ci commands. UserError and ConfigError now exit with code 1 instead of 2, preventing real errors from being misinterpreted as "has changes" in CI/CD pipelines.
