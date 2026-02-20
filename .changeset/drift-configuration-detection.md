---
'@krafteq/infraglue': minor
---

### New features

- **`ig install-skill`** command — installs the InfraGlue AI coding agent skill (SKILL.md) into the project directory for use with Claude Code and similar tools. Supports `--force` to overwrite existing files.
- **Configuration drift detection** in `ig drift` — now detects two types of drift per workspace: infrastructure drift (cloud ≠ state) and configuration drift (code ≠ state). Added `--refresh-only` flag to check only infrastructure drift.
- **Packaged skill file** (`packages/cli/skill/SKILL.md`) — ships a comprehensive AI agent skill covering all ig commands, configuration format, and workflows.

### Bug fixes

- Fix `ig plan --detailed` crash when `before`/`after` values are undefined in plan diff
- Fix `ig plan --detailed` to use `terraform show -json` for accurate attribute-level diffs
- Fix `ig plan --detailed` to skip duplicate formatted plan output when detailed view is shown
- Fix `ig drift` duplicate output by using `terraform plan -refresh=false` for configuration drift check
- Fix `ig apply --approve` to skip confirmation prompt in both interactive and non-interactive modes
- Fix `ig apply` duplicate plan output — formatted plan now appears once in the confirmation message instead of twice
