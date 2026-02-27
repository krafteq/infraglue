# @krafteq/infraglue

## 0.4.0

### Minor Changes

- e5b81c4: Add `skip_preview` workspace config to bypass preview/plan on initial deploy. Useful for Pulumi workspaces that connect to services not yet deployed.

### Patch Changes

- e5b81c4: Update SKILL.md with agent usage guidance, secret injection docs, skip_preview docs, and troubleshooting improvements
- e5b81c4: Use placeholder inputs during destroy when upstream workspace outputs are unavailable
- e5b81c4: Fix `--` separator in `pulumi config set` to handle dash-prefixed values correctly
- e5b81c4: Expand tilde in Pulumi `file://` backend URLs to prevent literal `~` directories being created

## 0.3.0

### Minor Changes

- 80a0cb4: - Add environment variable interpolation in ig.yaml configs
  - Add root-level vars and fix Pulumi secret output handling
  - Fix: pass --secret flag when injecting Pulumi secret values
  - Fix: resolve destroy crashes, stale locks, and add --approve-all support
  - Fix: avoid pnpm wrapper in bin/ig.js to prevent .npmrc warnings
  - Fix: resolve Dependabot security alerts and harden CI workflow permissions

## 0.2.0

### Minor Changes

- 2c2ef44: ### New features

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
