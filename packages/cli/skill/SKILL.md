---
name: infraglue
description: >
  InfraGlue (ig) — CLI tool for managing Infrastructure as Code (IaC) monorepos.
  Orchestrates Terraform and Pulumi workspaces with dependency resolution, output injection,
  environment management, drift detection, and state reconciliation.
  Use this skill when working with ig.yaml configs, ig CLI commands, or multi-workspace
  Terraform/Pulumi infrastructure projects.
  Keywords: terraform, pulumi, infrastructure, IaC, monorepo, workspace, ig, infraglue,
  drift, plan, apply, destroy, import, export, refresh, environment.
user-invokable: false
---

# InfraGlue (ig) — IaC Monorepo Orchestrator

InfraGlue orchestrates multiple Terraform and Pulumi workspaces in a single monorepo. It resolves dependencies between workspaces, manages per-environment configuration, and injects outputs from one workspace into another.

## Core Flow

1. `ig.yaml` at monorepo root defines which directories are workspaces
2. Each workspace has its own `ig.yaml` with dependencies, injection mappings, and environment config
3. `ig` builds a dependency graph, topologically sorts workspaces into execution levels
4. Workspaces at the same level run in the same stage; levels execute sequentially
5. Outputs from upstream workspaces are injected as variables into downstream workspaces

## Agent Usage

**If you are an AI coding agent, read this section first.** These rules prevent the most common mistakes agents make with ig.

1. **Let ig orchestrate — do NOT parallelize manually.** Run `ig apply --approve all` or `ig destroy --approve all` to operate on the full monorepo. ig handles dependency ordering, output injection, and parallelism internally. Do NOT run separate `ig apply --project X` commands in parallel — this is the single most common agent mistake.

2. **Never run ig commands concurrently.** ig uses a process-local mutex to protect `.ig/state.json`. Running two `ig` processes at the same time causes race conditions — lost output data, broken dependency injection, and corrupted state. Always wait for one `ig` command to finish before starting the next.

3. **Select the environment once, then omit `--env`.** For single-environment setups (or when working in one env for a session), run `ig env select <env>` once at the start. All subsequent commands use the selected env automatically. Only pass `--env` when you need to switch environments mid-session.

4. **Prefer whole-monorepo commands.** `ig plan`, `ig apply`, `ig destroy`, and `ig drift` all operate across every workspace by default. Only use `--project` for targeted single-workspace operations like debugging, import, or export.

5. **Use `--approve all` for apply and destroy.** ig auto-detects non-TTY environments and suppresses interactive prompts, but `ig apply` and `ig destroy` still require explicit `--approve` to proceed. Always pass `--approve all` in agent/CI contexts.

```bash
# Correct agent workflow
ig env select dev
ig plan                        # preview all workspaces
ig apply --approve all         # apply all workspaces in dependency order
ig drift                       # check for drift across all workspaces
ig destroy --approve all       # tear down in reverse dependency order
```

## Root-Level ig.yaml

Located at the monorepo root. Defines workspace discovery and global outputs.

```yaml
workspace:
  - './*' # glob patterns matching workspace directories

vars: # optional: shared variables injected into all workspaces at lowest priority
  region: us-east-1
  env_name: production

output: # optional: expose workspace outputs at monorepo level
  postgres_host: './postgres:database_host' # format: './workspace-dir:output_key'
  app_url: './express-service:app_url'
```

### Fields

| Field       | Type                     | Required | Description                                                                                        |
| ----------- | ------------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `workspace` | `string[]`               | Yes      | Glob patterns to discover workspace directories (must match at least one)                          |
| `vars`      | `Record<string, string>` | No       | Shared variables passed to all workspaces (lowest priority, overridden by env vars and injections) |
| `output`    | `Record<string, string>` | No       | Map of exported names to `'./workspace:output_key'` references                                     |

## Workspace-Level ig.yaml

Located in each workspace directory. Defines provider, dependencies, and environment config.

```yaml
provider: terraform # optional: auto-detected from files if omitted

injection: # optional: wire outputs from other workspaces as input variables
  network_name: '../docker-network:network_name'
  database_host: '../postgres:database_host'

depends_on: # optional: explicit ordering without injection
  - '../other-workspace'

alias: my-custom-name # optional: override workspace name (defaults to directory name)

output: # optional: rename/remap provider outputs
  public_name: internal_output_key

envs: # per-environment configuration
  dev:
    backend_type: local
    backend_config:
      path: ./terraform_dev.tfstate
    vars:
      instance_count: 1
    var_files:
      - ./envs/dev.tfvars
  qa:
    backend_file: ./envs/qa_backend.tf
    var_files:
      - ./envs/qa.tfvars
  prod:
    backend_type: s3
    backend_config:
      bucket: my-terraform-state
      key: prod/terraform.tfstate
    vars:
      instance_count: 3
    var_files:
      - ./envs/prod.tfvars
```

### Fields

| Field          | Type                        | Required | Description                                                                                                                               |
| -------------- | --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`     | `string`                    | No       | `terraform` or `pulumi`. Auto-detected if omitted (from `.tf` or `Pulumi.yaml` files)                                                     |
| `injection`    | `Record<string, string>`    | No       | Map of variable names to `'../workspace:output_key'` references. Creates implicit dependency                                              |
| `depends_on`   | `string[]`                  | No       | Explicit dependencies without output injection. Use relative paths like `'../workspace'`                                                  |
| `alias`        | `string`                    | No       | Custom workspace name (defaults to directory name)                                                                                        |
| `output`       | `Record<string, string>`    | No       | Remap provider output keys to different names                                                                                             |
| `envs`         | `Record<string, EnvConfig>` | No       | Per-environment configuration (see below)                                                                                                 |
| `skip_preview` | `boolean`                   | No       | Skip preview/plan and apply directly. Use for Pulumi providers that can't preview before first deploy (see [Skip Preview](#skip-preview)) |

### Environment Config (EnvConfig)

Each key under `envs` is an environment name with this structure:

| Field            | Type                     | Description                                                                                     |
| ---------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `backend_type`   | `string`                 | Terraform backend type (`local`, `s3`, `gcs`, etc.)                                             |
| `backend_file`   | `string`                 | Path to a backend configuration file (Terraform `.tf` file)                                     |
| `backend_config` | `Record<string, string>` | Backend-specific key-value config. For Pulumi: `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE` |
| `vars`           | `Record<string, string>` | Variables passed to the provider (Terraform `-var`, Pulumi config)                              |
| `var_files`      | `string[]`               | Variable files passed to provider (Terraform `-var-file`)                                       |

Use `backend_type` + `backend_config` OR `backend_file`, not both.

### Variable Priority

Variables are merged with the following priority (highest wins):

1. **Injections** (outputs from upstream workspaces) — highest priority
2. **Workspace env vars** (`envs.<env>.vars`) — overrides root vars
3. **Root vars** (`vars` in root ig.yaml) — lowest priority, shared defaults

This means a workspace can override root-level defaults by declaring the same variable in its `envs.<env>.vars`, and injections always take precedence over both.

### Environment Variable Interpolation

String values in `vars`, `backend_config`, `backend_type`, `backend_file`, and `var_files` support `${ENV_VAR}` syntax, resolved from the shell environment at parse time.

```yaml
# root ig.yaml
vars:
  region: ${AWS_REGION}

# workspace ig.yaml
envs:
  prod:
    backend_type: s3
    backend_config:
      bucket: ${TF_STATE_BUCKET}
      key: prod/terraform.tfstate
    vars:
      db_host: ${DATABASE_HOST}
    var_files:
      - ./envs/${AWS_REGION}.tfvars
```

- `${VAR}` resolves to the value of environment variable `VAR`
- `$${VAR}` escapes to the literal string `${VAR}` (no interpolation)
- A missing (unset) environment variable throws an error; empty string is valid
- Structural fields (`workspace`, `injection`, `depends_on`, `alias`, `provider`, `output`) are NOT interpolated

## Dependency Injection

Workspaces wire outputs from upstream workspaces using the `injection` field:

```yaml
# In workspace redis/ig.yaml
injection:
  network_name: '../docker-network:network_name'
```

This means: "take the `network_name` output from the `docker-network` workspace and pass it as the `network_name` variable to this workspace."

- The path is relative to the current workspace directory
- `injection` creates an implicit dependency (no need to also list in `depends_on`)
- `depends_on` is for ordering without data flow
- Secret values from upstream workspaces are auto-detected and injected with `--secret` (Pulumi) or as `sensitive` (Terraform). No manual secret marking needed (requires ig `>=0.2.1`)

## CLI Commands

```bash
# Plan and apply infrastructure
ig plan --env dev                     # preview changes without applying (exit code 2 = changes)
ig plan --env dev --detailed          # show attribute-level diffs
ig apply --env dev                    # apply all workspaces in dev environment
ig apply --env dev --project postgres # apply only the postgres workspace
ig apply --env dev --no-deps          # apply without running dependencies
ig destroy --env staging              # destroy all workspaces

# Drift detection and reconciliation
ig drift --env staging                # detect drift across all workspaces (exit code 2 = drift)
ig drift --env prod --json            # output structured DriftReport as JSON
ig drift --env dev --project postgres # check single workspace
ig refresh --env staging              # refresh state from cloud providers
ig refresh --env dev --project redis  # refresh single workspace
ig import aws_instance.web i-123 --project webserver --env staging   # import existing resource
ig export aws_instance.web i-123 --project webserver --env staging   # generate code to stdout

# Environment management
ig env select dev                     # select active environment
ig env current                        # show current environment

# Configuration
ig config show                        # display parsed monorepo config
ig config show --json                 # JSON output for scripting

# Provider passthrough (stdout/stderr are passed through directly via stdio: inherit)
ig provider plan                      # run provider CLI command in current workspace dir
ig provider output -json              # get raw provider outputs

# Shell completions
ig completion bash >> ~/.bashrc
ig completion zsh >> ~/.zshrc
ig completion fish > ~/.config/fish/completions/ig.fish

# Install this skill
ig install-skill                      # install into .claude/skills/infraglue/SKILL.md
ig install-skill --force              # overwrite existing
```

### Non-Interactive / CI Usage

> **AI agents:** see the [Agent Usage](#agent-usage) section above for the correct workflow. The details below are reference for CI pipelines and scripting.

**`--approve` syntax** (for `ig apply` and `ig destroy`):

| Value   | Effect                             |
| ------- | ---------------------------------- |
| `all`   | Auto-approve every execution level |
| `1`     | Auto-approve level 1 only          |
| `1,2,3` | Auto-approve specific levels       |

Level numbers are 1-indexed. Without `--approve`, the command waits for interactive confirmation.

**Exit codes:** `0` = success / no changes, `1` = error, `2` = changes detected (plan/drift)

**TTY detection:** when no TTY is detected (CI, piped output, agent subprocess), ig auto-selects the `no-tty-cli` integration which suppresses interactive prompts. `ig plan` and `ig drift` are always non-interactive.

### Live Progress Display

During `ig apply` and `ig destroy`, ig streams real-time progress from Terraform and Pulumi. Both providers emit NDJSON events when run with `--json`, which ig parses to show per-resource status.

**TTY (default compact view)** — one line per workspace showing resource count, current operation, and elapsed time:

```text
  ok redis        2/5 resources   creating docker:index:Container  (3s)
  ok postgres     1/3 resources   creating aws:rds:Instance  (15s)
```

**TTY verbose (`-v`)** — expanded per-resource detail:

```text
  * redis
      ok docker:index:Image         pulled        0.8s
      *  docker:index:Container     creating...   3s
```

**Non-TTY/CI** — append-only prefixed lines (no ANSI cursor codes):

```text
[redis] create docker_network.main
[redis] create docker_network.main (12s)
[postgres] error: aws_rds.main - DBInstanceAlreadyExists
```

### Global Options

| Option                  | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `-d, --directory <dir>` | Root directory of the monorepo (defaults to `.`) |
| `-v, --verbose`         | Verbose output                                   |
| `-q, --quiet`           | Quiet output                                     |
| `--strict`              | Fail on most warnings                            |

### Environment Variables

| Variable                   | Values      | Description                                                                                                                                               |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IG_DEBUG` / `IG_VERBOSE`  | `1`         | Enable verbose/debug output (same as `--verbose` flag)                                                                                                    |
| `IG_DISABLE_STATE_OUTPUTS` | `1`, `true` | Skip caching workspace outputs in `.ig/state.json`. Outputs are always fetched live from the provider. Use when you don't want secrets persisted to disk. |

### Drift Detection

`ig drift` detects two types of drift without modifying state:

- **Infrastructure drift** (cloud ≠ state): resources changed outside IaC. Uses `terraform plan -refresh-only` / `pulumi refresh --preview-only`.
- **Configuration drift** (code ≠ state): code changes not yet applied (e.g., removed resources still in state). Uses `terraform plan -refresh=false` / `pulumi preview` (refresh disabled to isolate code-vs-state changes from cloud drift).

Both checks run per workspace by default. Use `--refresh-only` to skip configuration drift and only check infrastructure drift.

- Multi-workspace: orchestrated across dependency levels with output injection
- `--json` outputs a `DriftReport` with per-workspace drift status including `infrastructureDrift` and `configurationDrift` sub-reports
- `--refresh-only` skips configuration drift check (only cloud vs state)
- Exit code 2 means drift was detected, 0 means in sync

### Import and Export

`ig import` and `ig export` are single-workspace commands (require `--project` and `--env`). Arguments after the command are passed through to the provider:

- **Terraform import**: `ig import <address> <cloud-id> --project <ws> --env <env>`
- **Pulumi import**: `ig import <type> <name> <cloud-id> --project <ws> --env <env>`
- **Export/generate code**: same argument patterns, generated code is written to stdout

## How to Add a New Workspace

1. Create a directory in the monorepo (e.g., `my-service/`)
2. Ensure it matches a glob in the root `ig.yaml` `workspace` field
3. Add your IaC files (`.tf` files for Terraform, `Pulumi.yaml` + `index.ts` for Pulumi)
4. Create `my-service/ig.yaml` with environment config:

```yaml
envs:
  dev:
    backend_type: local
    backend_config:
      path: ./terraform_dev.tfstate
    vars:
      name: dev_my_service
```

5. If it depends on another workspace's outputs, add `injection`:

```yaml
injection:
  vpc_id: '../networking:vpc_id'

envs:
  dev:
    backend_type: local
    backend_config:
      path: ./terraform_dev.tfstate
```

6. Run `ig config show` to verify the workspace is discovered and dependencies are correct
7. Run `ig apply --env dev` to apply

## Provider Auto-Detection

If `provider` is not set in a workspace's `ig.yaml`, ig detects it automatically:

- **Terraform**: directory contains `.tf` files
- **Pulumi**: directory contains `Pulumi.yaml`

## Environment State

The selected environment is stored in `.ig/.env` at the monorepo root. This file is created by `ig env select` and persists across commands. Pass `--env` to override without changing the stored selection.

## Skip Preview

Set `skip_preview: true` in a workspace's `ig.yaml` to bypass the preview/plan step and apply directly. This is useful for Pulumi workspaces that use providers connecting to services not yet deployed (e.g., a Pulumi program that configures a database created by another workspace — the preview would fail because the database doesn't exist yet).

```yaml
skip_preview: true

envs:
  dev:
    backend_config:
      PULUMI_BACKEND_URL: file://./state
      PULUMI_CONFIG_PASSPHRASE: ''
```

When `skip_preview` is enabled:

- `ig plan` skips the workspace entirely (no preview is run)
- `ig apply` applies without running a preview first (Pulumi: `pulumi up --yes --skip-preview`)
- `ig destroy` is unaffected (destroy preview still runs)
- The workspace still participates in dependency resolution and output injection

## Output-Only Change Detection

When `ig plan` or `ig apply` detects no resource changes in a workspace, it compares the plan's outputs against cached state outputs. If outputs differ (new exports added, values changed, or exports removed), the workspace is included in the plan instead of being skipped. This is particularly useful for Pulumi workspaces where output-only changes (e.g., adding a new `pulumi.export()`) don't appear as resource changes in the preview.

## Troubleshooting

| Error                                    | Cause                                                | Fix                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Monorepo not found in <dir>`            | No `ig.yaml` with `workspace` field found            | Ensure root `ig.yaml` exists with `workspace` globs                                                                            |
| `No environment selected`                | No env stored and no `--env` flag                    | Run `ig env select <env>` or pass `--env`                                                                                      |
| `Single workspace is required`           | `provider` command run from monorepo root            | `cd` into a workspace dir or pass `--project`                                                                                  |
| Workspace not discovered                 | Directory doesn't match any `workspace` glob         | Check glob patterns in root `ig.yaml`                                                                                          |
| Provider not detected                    | No `.tf` or `Pulumi.yaml` files in workspace         | Add IaC files or set `provider` explicitly in workspace `ig.yaml`                                                              |
| `Environment variable 'X' is not set`    | `${X}` used in config but `X` is not in env          | Set the env var or use `$${X}` to escape as literal                                                                            |
| Provider state locked after failed apply | A previous `ig apply` or `ig destroy` failed mid-run | Run `ig provider force-unlock <lock-id>` in each failed workspace, or `pulumi cancel` for Pulumi                               |
| Destroy fails with missing upstream      | Upstream workspace already destroyed in a prior run  | ig `>=0.3.0` handles this automatically with placeholder inputs. On older versions, re-apply upstream first or use `--no-deps` |
| Corrupted state / lost outputs           | Multiple `ig` processes ran concurrently             | Never run ig commands in parallel — ig uses a process-local mutex on `.ig/state.json`. Wait for each command to finish         |
