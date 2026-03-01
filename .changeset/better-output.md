---
'@krafteq/infraglue': minor
---

### Streaming live view for apply and destroy

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
