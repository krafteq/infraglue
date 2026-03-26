---
'@krafteq/infraglue': minor
'@krafteq/infraglue-bridge': minor
---

feat: GitLab CI approval workflow with bridge and bridge-less modes

**New package: `@krafteq/infraglue-bridge`** — Webhook relay service that receives GitLab emoji reactions on MR plan comments and triggers CI pipelines with approval context. Extensible for GitHub/TeamCity.

**New command: `ig ci`** — Bridge-less GitLab CI mode. Single pipeline job reads MR comments + emoji reactions, applies approved levels, plans forward, and posts comments. Handles FRESH/STALE/PENDING/PARTIAL/COMPLETE states automatically.

**New features:**

- `--up-to-level <N>` for `ig apply`/`ig destroy` — caps execution at level N
- `ig plan` auto-posts MR comments with collapsible plans in GitLab MR pipelines
- `IG_ACTION`/`IG_APPROVED_LEVEL` env var auto-detection for bridge-triggered pipelines
- `startFromLevel` on plan for resuming after partial apply
- `commitSha` in ig-meta for staleness detection
