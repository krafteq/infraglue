---
name: infraglue
description: InfraGlue (ig) CLI tool for managing Infrastructure as Code monorepos with Terraform and Pulumi workspace orchestration
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

## Root-Level ig.yaml

Located at the monorepo root. Defines workspace discovery and global outputs.

```yaml
workspace:
  - './*' # glob patterns matching workspace directories

output: # optional: expose workspace outputs at monorepo level
  postgres_host: './postgres:database_host' # format: './workspace-dir:output_key'
  app_url: './express-service:app_url'
```

### Fields

| Field       | Type                     | Required | Description                                                               |
| ----------- | ------------------------ | -------- | ------------------------------------------------------------------------- |
| `workspace` | `string[]`               | Yes      | Glob patterns to discover workspace directories (must match at least one) |
| `output`    | `Record<string, string>` | No       | Map of exported names to `'./workspace:output_key'` references            |

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

| Field        | Type                        | Required | Description                                                                                  |
| ------------ | --------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `provider`   | `string`                    | No       | `terraform` or `pulumi`. Auto-detected if omitted (from `.tf` or `Pulumi.yaml` files)        |
| `injection`  | `Record<string, string>`    | No       | Map of variable names to `'../workspace:output_key'` references. Creates implicit dependency |
| `depends_on` | `string[]`                  | No       | Explicit dependencies without output injection. Use relative paths like `'../workspace'`     |
| `alias`      | `string`                    | No       | Custom workspace name (defaults to directory name)                                           |
| `output`     | `Record<string, string>`    | No       | Remap provider output keys to different names                                                |
| `envs`       | `Record<string, EnvConfig>` | No       | Per-environment configuration (see below)                                                    |

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

## CLI Commands

```bash
# Apply/destroy infrastructure
ig apply --env dev                    # apply all workspaces in dev environment
ig apply --env dev --project postgres # apply only the postgres workspace
ig apply --env dev --no-deps          # apply without running dependencies
ig destroy --env staging              # destroy all workspaces

# Environment management
ig env select dev                     # select active environment
ig env current                        # show current environment

# Configuration
ig config show                        # display parsed monorepo config
ig config show --json                 # JSON output for scripting

# Provider passthrough
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

### Global Options

| Option                  | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `-d, --directory <dir>` | Root directory of the monorepo (defaults to `.`) |
| `-v, --verbose`         | Verbose output                                   |
| `-q, --quiet`           | Quiet output                                     |
| `--strict`              | Fail on most warnings                            |

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

## Troubleshooting

| Error                          | Cause                                        | Fix                                                               |
| ------------------------------ | -------------------------------------------- | ----------------------------------------------------------------- |
| `Monorepo not found in <dir>`  | No `ig.yaml` with `workspace` field found    | Ensure root `ig.yaml` exists with `workspace` globs               |
| `No environment selected`      | No env stored and no `--env` flag            | Run `ig env select <env>` or pass `--env`                         |
| `Single workspace is required` | `provider` command run from monorepo root    | `cd` into a workspace dir or pass `--project`                     |
| Workspace not discovered       | Directory doesn't match any `workspace` glob | Check glob patterns in root `ig.yaml`                             |
| Provider not detected          | No `.tf` or `Pulumi.yaml` files in workspace | Add IaC files or set `provider` explicitly in workspace `ig.yaml` |
