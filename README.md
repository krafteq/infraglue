# InfraGlue

**InfraGlue** is a powerful CLI tool designed to manage Infrastructure as Code (IaC) monorepos. It simplifies the orchestration of multiple IaC projects (Terraform, Pulumi, etc.) by handling dependencies, environments, and execution order automatically.

With InfraGlue, you can define dependencies between your infrastructure components, allowing values to be injected from one project to another. The tool ensures that changes are applied in the correct topological order (levels), making it ideal for complex infrastructure setups.

## Features

- **Monorepo Support**: Manage multiple infrastructure projects within a single repository.
- **Automatic Dependency Management**: Detects dependencies based on output injection and builds an execution graph.
- **Level-based Execution**: Applies or destroys changes in stages (levels) to ensure dependent resources are ready.
- **Multi-Environment Support**: Define and manage multiple environments (e.g., `dev`, `qa`, `prod`) with distinct backends and configurations for the same projects.
- **Output Injection**: Easily inject outputs from one project as inputs (variables) into another.
- **Flexible Integrations**: Supports interactive CLI mode by default, with options for non-interactive execution (`no-tty-cli`) and future CI/CD platform integrations (e.g., GitLab).
- **Provider Agnostic**: Designed to work with Terraform, Pulumi, and more (extensible).
- **Direct Provider Access**: Pass commands directly to the underlying provider while maintaining environment context.

## Installation

```bash
npm install -g @krafteq/infraglue
```

## Getting Started

### Directory Structure

A typical InfraGlue monorepo looks like this:

```text
my-infra-repo/
├── ig.yaml                 # Root configuration
├── network/                # Project 1
│   ├── ig.yaml             # Project configuration
│   ├── main.tf
│   └── ...
├── database/               # Project 2 (depends on network)
│   ├── ig.yaml
│   ├── main.tf
│   └── ...
└── app/                    # Project 3 (depends on database)
    ├── ig.yaml
    ├── Pulumi.yaml
    └── ...
```

### Configuration

#### Root Configuration (`ig.yaml`)

The root `ig.yaml` defines where to find your projects (workspaces).

```yaml
# ig.yaml
provider: platform

workspace:
  - './*' # Glob pattern to find projects

# Optional: Define global aliases for outputs
output:
  network_id: './network:vpc_id'
```

#### Project Configuration (`project/ig.yaml`)

Each project has its own `ig.yaml` to define dependencies and environment-specific settings.

```yaml
# database/ig.yaml

# Inject outputs from other projects as variables
injection:
  vpc_id: '../network:vpc_id' # Injects 'vpc_id' output from 'network' project

# Environment configurations
envs:
  dev:
    backend_type: local # or s3, gcs, etc.
    backend_config:
      path: ./terraform_dev.tfstate
    var_files:
      - ./envs/dev.tfvars
  prod:
    backend_type: s3
    backend_config:
      bucket: my-infra-state
      key: prod/database.tfstate
    var_files:
      - ./envs/prod.tfvars
```

## Usage

### Managing Environments

Select the environment you want to work with:

```bash
ig env select dev
```

Check the current environment:

```bash
ig env current
```

### Applying Changes

To apply changes to your infrastructure:

```bash
ig apply
```

This command will:

1.  Analyze dependencies.
2.  Group projects into levels.
3.  Execute them in order.

**Interactive Mode (Default):**
By default, the tool runs with `--integration cli`, which pauses between levels or projects, allowing you to review plans interactively.

**CI/CD & Non-Interactive Mode:**
For automation or CI/CD pipelines where no TTY is available, use the `no-tty-cli` integration.

```bash
# Run without interactive prompts
ig apply --integration no-tty-cli
```

In non-interactive mode, you must explicitly approve changes for each level using the `--approve` argument. This ensures safety when applying changes automatically.

If your changes span multiple levels (e.g., 3 levels), you must call the tool separately for each level:

```bash
# Apply level 1
ig apply --integration no-tty-cli --approve 1

# Apply level 2
ig apply --integration no-tty-cli --approve 2

# Apply level 3
ig apply --integration no-tty-cli --approve 3
```

**Other Options:**

```bash
# Apply without dependencies (if you know what you are doing)
ig apply --no-deps

# Apply a specific project
ig apply --project database
```

### Destroying Resources

To destroy infrastructure:

```bash
ig destroy
```

This processes the dependency graph in reverse order. Like `apply`, it defaults to interactive mode but supports `--integration no-tty-cli`.

### Direct Provider Commands

You can run raw commands for the underlying provider (e.g., `terraform` or `pulumi`) while benefiting from InfraGlue's environment management (variables, backends).

```bash
# Runs 'terraform plan' or 'pulumi preview' for the current project context
ig provider plan
```

### Inspecting Configuration

To see the loaded configuration and resolved workspaces:

```bash
ig config show
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
