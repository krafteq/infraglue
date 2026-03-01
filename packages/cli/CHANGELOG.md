# @krafteq/infraglue

## 0.5.0

### Minor Changes

- eab52ad: ### Streaming live view for apply and destroy

  Apply and destroy now show real-time progress with a live-updating terminal UI. Each workspace displays resource operations as they happen, with slow resources (>30s) highlighted. Non-TTY environments get line-by-line event output for CI compatibility.

  ### Parallel plan gathering with live progress

  Plan gathering for workspaces within the same execution level now runs in parallel, with a live spinner showing per-workspace status and timing.

  ### Plan file reuse and --start-with-project

  Plan files are now saved during `ig apply` planning and passed to the apply step, ensuring the exact reviewed plan is applied. The `--start-with-project` flag allows resuming a multi-level apply from a specific workspace, using cached outputs for skipped levels.

  ### Terminal-friendly formatter and --skip-preview

  The default plan formatter now uses a compact terminal-friendly table format. The `--skip-preview` flag suppresses the formatted plan table in the plan summary.

  ### Cleaner plan summary and apply output

  - Plan summary uses compact `+N ~N -N` format instead of verbose `Add: N, Change: N, ...`
  - Removed `Inputs:` JSON dump from plan summary and confirmation prompt (security risk)
  - Secret outputs masked with `[secret]` in final global outputs

  ### Environment variable files (.ig/.env)

  ig now loads `.ig/.env` (base) and `.ig/.env.{envName}` (per-environment) files into `process.env` before config interpolation. Values are available for `${VAR}` substitution in ig.yaml and automatically flow to provider subprocesses. The `.ig/` directory is already gitignored, making it safe for secrets and local overrides.

  ### Skip plan step when --approve is set

  Pre-approved levels now skip the plan step entirely and apply directly, which is faster — especially for Pulumi where preview and up both run the program.

  ### Apply output change counters

  The live view during apply/destroy now shows per-workspace change breakdowns (`+N ~N -N`) alongside progress counts, and level completion messages include aggregated totals.

  ### Other fixes

  - `--env` is now optional for `import` and `export` commands
  - Noisy workspace-interop logs demoted to debug level
  - Fixed Pulumi stack auto-creation broken by ProviderError formatting
  - Extracted diagnostic extraction into a dedicated module with ProviderError integration tests

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
