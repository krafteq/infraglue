# InfraGlue

InfraGlue (`ig`) is a CLI tool for managing Infrastructure as Code monorepos. It orchestrates multiple Terraform and Pulumi workspaces, resolving dependencies between them, managing per-environment configuration, and injecting outputs from one workspace into another.

> **Status:** Early development (v0.1.x). The core workflow works but the API may change.

## Why

When infrastructure grows beyond a single Terraform root module or Pulumi project, you end up with multiple workspaces that depend on each other. A database needs the VPC ID from the network stack, the app needs the database host, etc.

InfraGlue solves this by:

- Reading a dependency graph from simple `ig.yaml` files
- Sorting workspaces into execution levels (topological order)
- Running plan/apply/destroy level by level
- Passing outputs from one workspace as inputs to the next

It works with both Terraform and Pulumi in the same monorepo.

## Install

```bash
npm install -g @krafteq/infraglue
```

Requires Node.js >= 22.10.0. Terraform and/or Pulumi must be installed separately.

## Quick start

### 1. Structure your repo

```text
my-infra/
  ig.yaml                  # root config — lists workspace locations
  network/
    ig.yaml                # workspace config — env-specific backends/vars
    main.tf
  database/
    ig.yaml                # declares dependency on network
    main.tf
  app/
    ig.yaml                # depends on database + network
    Pulumi.yaml
```

### 2. Define the root config

The root `ig.yaml` tells InfraGlue where to find workspaces and optionally exports top-level outputs.

```yaml
# ig.yaml (root)
workspace:
  - './*'

output:
  db_host: './database:host'
  app_url: './app:url'
```

### 3. Configure each workspace

Each workspace `ig.yaml` declares its dependencies via `injection` and its per-environment settings via `envs`. The provider (Terraform or Pulumi) is auto-detected from the workspace contents.

```yaml
# database/ig.yaml
injection:
  vpc_id: '../network:vpc_id' # output "vpc_id" from network → variable "vpc_id" here

envs:
  dev:
    backend_type: local
    backend_config:
      path: ./terraform_dev.tfstate
    var_files:
      - ./envs/dev.tfvars
  prod:
    backend_type: s3
    backend_config:
      bucket: my-state
      key: prod/database.tfstate
    var_files:
      - ./envs/prod.tfvars
```

### 4. Select an environment and apply

```bash
ig env select dev
ig apply
```

InfraGlue will:

1. Parse all `ig.yaml` files and build the dependency graph
2. Group workspaces into levels (e.g., network first, then database, then app)
3. For each level: show the plan, ask for confirmation, apply, capture outputs
4. Inject captured outputs into the next level's workspaces

## CLI reference

```text
ig [options] [command]

Options:
  -d, --directory <dir>    Root directory of the monorepo (default: ".")
  -v, --verbose            Show verbose output
  -q, --quiet              Show quiet output
  --strict                 Fail on most warnings
  -V, --version            Print version
  -h, --help               Show help

Commands:
  env select <env>         Select the active environment
  env current              Show the current environment
  apply [options]          Plan and apply changes
  destroy [options]        Destroy resources (reverse dependency order)
  config show              Show resolved configuration
  provider [args...]       Pass commands directly to the underlying provider
  completion <shell>       Output shell completion script (bash, zsh, fish)
```

### apply / destroy options

```bash
ig apply                                  # interactive (default)
ig apply --integration no-tty-cli         # non-interactive (CI)
ig apply --integration no-tty-cli --approve 1   # auto-approve level 1
ig apply --no-deps                        # skip dependency resolution
ig apply --project database               # apply a single workspace
ig destroy                                # destroy in reverse order
```

In non-interactive mode, each level must be explicitly approved with `--approve <level>`. This is intentional for CI safety -- run the command once per level.

## Workspace config reference

```yaml
# Optional: override auto-detected provider
provider: terraform # or "pulumi"

# Optional: alias used as display name instead of directory name
alias: my-database

# Inject outputs from other workspaces as input variables
injection:
  var_name: '../other-workspace:output_name'

# Explicit dependency without injection
depends_on:
  - '../other-workspace'

# Per-environment configuration
envs:
  dev:
    backend_type: local # Terraform backend type
    backend_file: ./backend.tf # or point to a backend file
    backend_config: # backend-specific settings
      path: ./state.tfstate
    vars: # Terraform variables / Pulumi config
      instance_count: 1
    var_files: # Terraform .tfvars files
      - ./envs/dev.tfvars

# Static outputs (rarely needed — outputs are usually captured at runtime)
output:
  key: value
```

## Example

The [`examples/terraform_and_pulumi/`](examples/terraform_and_pulumi/) directory contains a working monorepo with 4 workspaces:

```text
docker-network (Pulumi) ──→ redis (Pulumi)
                         ──→ postgres (Terraform) ──→ express-service (Terraform)
```

The `docker-network` workspace produces a `network_name` output. Both `redis` and `postgres` inject it as an input. The `express-service` workspace injects all outputs from `postgres` plus the network name and Redis connection string.

Run it locally (requires Docker, Terraform, and Pulumi):

```bash
git clone https://github.com/krafteq/infraglue.git
cd infraglue
pnpm install
pnpm ig-example          # launches the CLI pointed at the example
```

## Development

```bash
pnpm install             # install dependencies
pnpm test                # run unit tests
pnpm test:e2e            # run e2e tests (filesystem fixtures)
pnpm test:all            # run everything
pnpm lint                # eslint
pnpm format              # prettier
pnpm ts:check            # typecheck
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

## Releasing

Releases are managed with [changesets](https://github.com/changesets/changesets) and automated via GitHub Actions.

### Standard release

1. **Add a changeset** when making changes that should be released:

   ```bash
   pnpm changeset
   ```

   Select `@krafteq/infraglue`, pick the semver bump (patch/minor/major), and write a summary.

2. **Commit the changeset file** (`.changeset/<random-name>.md`) with your PR.

3. **Merge your PR to `master`**. The release action will create a "chore: version packages" PR that bumps `package.json` version and updates `CHANGELOG.md`.

4. **Merge the version PR**. This triggers `pnpm release`, which builds and publishes to npm with provenance.

### Canary release (for testing)

To publish a canary version from a PR for testing before merging:

1. Add the `canary` label to the PR on GitHub.
2. The canary workflow publishes to npm under the `canary` dist-tag.
3. Install it with:

   ```bash
   npm install -g @krafteq/infraglue@canary
   ```

4. To publish a new canary, remove and re-add the `canary` label.

## License

MIT
