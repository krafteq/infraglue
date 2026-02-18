# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

InfraGlue (`ig`) is a CLI tool for managing Infrastructure as Code monorepos. It orchestrates multiple Terraform/Pulumi workspaces by resolving dependencies, managing environments, and injecting outputs between workspaces. The main package is `@krafteq/infraglue` in `packages/cli/`.

## Common Commands

```bash
pnpm test                                # Run unit tests (Vitest) — fast, no filesystem
pnpm test:e2e                            # Run e2e tests — filesystem fixtures, temp dirs
pnpm test:all                            # Run all tests (unit + e2e)
pnpm test -- --testPathPattern=model     # Run a single test file by name
pnpm test:watch                          # Watch mode
pnpm lint                                # ESLint
pnpm lint:fix                            # ESLint with auto-fix
pnpm format:check                        # Prettier check
pnpm format                              # Prettier write
pnpm ts:check                            # TypeScript type checking across all packages

# Build the CLI package
cd packages/cli && pnpm build            # tsc compilation to dist/

# Run ig CLI against the example monorepo
pnpm ig-example                          # tsx ./packages/cli/src/index.ts -d ./examples/terraform_and_pulumi/
pnpm apply                               # apply all workspaces in example
pnpm destroy                             # destroy all workspaces in example
```

## Architecture

### Core Flow

`index.ts` (Commander.js CLI) → `monorepo-reader.ts` (parse ig.yaml configs) → `model.ts` (build Monorepo/Workspace graph) → `multistage-executor.ts` (topological sort into levels, execute sequentially) → providers (Terraform/Pulumi commands)

### Key Source Directories (`packages/cli/src/`)

- **core/** — Domain models (`Monorepo`, `Workspace`, `ExecutionContext`, `ExecutionPlanBuilder`), config parsing, environment management, execution engine
- **providers/** — Abstract `IProvider` interface with `TerraformProvider` and `PulumiProvider` implementations. Each wraps the respective CLI tool
- **integrations/** — Execution modes: interactive CLI, non-TTY (CI), GitLab CI (draft)
- **formatters/** — Output formatting (text, table)
- **utils/** — Logger, custom errors (`UserError`), mutex, helpers

### Configuration System

- `ig.yaml` at monorepo root defines workspace globs and global outputs
- `ig.yaml` per workspace defines `depends_on`, `injection` (output wiring between workspaces), and `envs` (per-environment backend/vars)
- Environment state stored in `.ig/.env`

### Dependency Resolution

Workspaces declare dependencies via `injection` mappings (e.g., `network_name: '../docker-network:network_name'`). `ExecutionPlanBuilder` performs topological sort to create execution levels — workspaces at the same level run in the same stage, levels execute sequentially.

### Example Monorepo

`examples/terraform_and_pulumi/` has 4 workspaces: `docker-network` (Pulumi) → `redis` (Pulumi), `postgres` (Terraform) → `express-service` (Terraform), demonstrating cross-provider dependency injection.

## Code Conventions

- **ES Modules** throughout (verbatimModuleSyntax, ESNext module target)
- **Prettier**: single quotes, no semicolons, 120 print width
- **Conventional Commits**: enforced by commitlint + husky (feat, fix, refactor, etc.)
- **Node.js 22.10.0+**, **pnpm 10.12.1+**
- TypeScript strict mode with all strict flags enabled
- Tests use **Vitest** with globals enabled; unit tests are `*.test.ts`, e2e tests are `*.e2e.test.ts`

## Git Hooks (Husky)

Git hooks run automatically on commit. Ensure your changes pass before committing.

- **pre-commit** — Runs `pnpm lint-staged` (eslint --fix + prettier on staged files) AND `pnpm ts:check` (TypeScript type-checking). Both must pass.
- **commit-msg** — Runs `commitlint` to enforce Conventional Commits format (e.g., `feat:`, `fix:`, `refactor:`).

If a hook fails, fix the issue and re-stage. Key gotchas:

- ESLint's `markdown/fenced-code-language` rule requires a language tag on ALL fenced code blocks in `.md` files (including SKILL.md). Use `text` for non-code examples.
- lint-staged only checks staged files — unstaged fixes won't be seen. Stage your fixes before retrying.

## Testing Conventions

Every new feature or bug fix MUST include tests. Run `pnpm test:all` before considering work complete.

### Unit vs E2E Split

- **`*.test.ts`** (unit) — Pure logic, mocked dependencies, no filesystem. Runs in CI via `pnpm test`.
- **`*.e2e.test.ts`** (e2e) — Reads fixture directories, creates temp dirs, touches real filesystem. Runs locally via `pnpm test:e2e`. NOT in CI yet.

### Test Infrastructure

- **Shared helpers** — `packages/cli/src/__test-utils__/`
  - `mock-provider.ts` — `MockProvider` (vi.fn spies), `createWorkspace()`, `createMonorepo()`, `createProviderPlan()`
  - `provider-fixtures.ts` — Raw JSON strings representing real Terraform/Pulumi CLI output
- **Static fixtures** — `packages/cli/src/core/__fixtures__/` — 6 monorepo directories for filesystem-dependent tests (simple-chain, cross-provider, diamond-dependency, multi-env, injection-only, no-config-workspace)
- **Exported pure parsers** — `parseTerraformPlanOutput()` and `parsePulumiPreviewOutput()` are exported functions (extracted from private methods for direct testability)

### What to Test

| Layer                                 | How to test                                         | File                                              |
| ------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| Zod schemas                           | Direct parse/safeParse, no mocking                  | `schemas.test.ts`                                 |
| Pure functions (parsers, graph sort)  | Import and call with fixture data                   | `terraform-provider.e2e.test.ts`, `utils.test.ts` |
| Config parsing (monorepo-reader)      | Static fixture directories, real filesystem         | `monorepo-reader.e2e.test.ts`                     |
| State persistence                     | Real temp directories (mkdtemp + cleanup)           | `state-manager.e2e.test.ts`                       |
| Orchestration (executor, env-manager) | `vi.mock` dependencies, assert interaction sequence | `multistage-executor.test.ts`                     |
| Adapters (workspace-interop)          | MockProvider with vi.fn spies, mock StateManager    | `workspace-interop.test.ts`                       |

### Patterns

- **New provider output format?** Add fixture strings to `provider-fixtures.ts`, test the parser function directly.
- **New config field?** Add it to a fixture `ig.yaml` in `__fixtures__/`, test parsing in `monorepo-reader.test.ts`.
- **New orchestration behavior?** Mock `WorkspaceInterop` and `StateManager` via `vi.mock`, test in `multistage-executor.test.ts`.
- **New dependency topology?** Add a fixture directory or use `createWorkspace()`/`createMonorepo()` helpers in `model.test.ts`.
- **Complex private method?** Extract as an exported pure function, delegate from the class, test the function directly with fixtures.
