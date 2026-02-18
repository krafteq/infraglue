---
name: vitest-test-patterns
description: Patterns for writing comprehensive Vitest test suites in TypeScript projects. Covers shared test utilities, vi.mock for module mocking, fixture directories, provider/adapter testing, and state management testing. Tier - generic.
user-invokable: false
---

# Vitest Test Patterns

## Goal

Establish reusable patterns for writing comprehensive test suites with Vitest in TypeScript ESM projects.

## Shared Test Utilities

Create `src/__test-utils__/` with reusable helpers:

```ts
// __test-utils__/mock-adapter.ts
import { vi } from 'vitest'
import type { IAdapter } from '../adapters/adapter.js'

export class MockAdapter implements IAdapter {
  // Use vi.fn() for every method — enables spying, return value control, call assertions
  doWork = vi.fn<IAdapter['doWork']>((): Promise<Result> => {
    throw new Error('Method not implemented.')
  })
  getName = vi.fn(() => 'mock')
}

// Factory helpers with sensible defaults
export function createThing(name: string, overrides: Partial<ThingConfig> = {}): Thing {
  return new Thing(name, `/path/to/${name}`, { env: 'dev', ...overrides })
}
```

**Key pattern:** Use `vi.fn<InterfaceType['methodName']>()` for type-safe mock methods.

## Module Mocking with vi.mock

### Mocking a dependency with shared state

When the SUT creates its own instance of a dependency internally, mock the module and use shared variables to control behavior:

```ts
const mockRead = vi.fn()
const mockUpdate = vi.fn()

vi.mock('./state-manager.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./state-manager.js')>()
  return {
    ...original, // Preserve non-mocked exports (e.g., State class)
    StateManager: vi.fn().mockImplementation(() => ({
      read: mockRead,
      update: mockUpdate,
    })),
  }
})
```

### Gotcha: Shared state across mock calls

When mocking `update(fn)` where `fn` mutates state, use a **shared state object** so mutations from one call are visible to the next:

```ts
// WRONG — each call gets a fresh object, mutations are lost
mockUpdate.mockImplementation(async (fn) => {
  fn(new State()) // ← startSelectingEnv() lost before finishEnvSelection()
})

// RIGHT — shared state preserves mutations across calls
let sharedState = new State()
mockUpdate.mockImplementation(async (fn) => {
  fn(sharedState)
})
```

## Static Fixture Directories

For filesystem-dependent code (config parsers, file scanners), use static fixture dirs checked into the repo:

```text
src/core/__fixtures__/
  simple-case/         # Happy path
    config.yaml
    sub-dir/config.yaml
  edge-case/           # Error paths, missing files
    config.yaml
  complex-case/        # Multiple interacting components
    config.yaml
    a/config.yaml
    b/config.yaml
```

Reference fixtures with `import.meta.dirname`:

```ts
const FIXTURES_DIR = resolve(import.meta.dirname, '__fixtures__')

it('should parse config', async () => {
  const result = await parseConfig(join(FIXTURES_DIR, 'simple-case'))
  expect(result.items).toHaveLength(2)
})
```

**When to use temp dirs instead:** For tests that write files (state persistence, temp files). Use `mkdtemp` + `afterEach` cleanup:

```ts
let tmpDir: string
beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'test-'))
})
afterEach(async () => {
  await rm(tmpDir, { recursive: true })
})
```

## Extract Pure Functions for Testability

When a class has complex private parsing/transformation logic, extract it as an **exported pure function** while keeping the class method as a one-line delegate:

```ts
// Before: private method, untestable directly
class MyProvider {
  private parseOutput(raw: string): Plan {
    /* 80 lines of parsing */
  }
}

// After: exported pure function + thin delegate
class MyProvider {
  private parseOutput(raw: string): Plan {
    return parseProviderOutput(raw, this.name)
  }
}

export function parseProviderOutput(raw: string, name: string): Plan {
  /* same 80 lines, now directly testable */
}
```

Test the exported function with fixture data:

```ts
// __test-utils__/provider-fixtures.ts — raw JSON strings representing real CLI output
export const PROVIDER_OUTPUT_CREATE = '{"type":"create","resources":[...]}'
export const PROVIDER_OUTPUT_NO_CHANGES = '{"type":"no-op"}'

// provider.test.ts
import { parseProviderOutput } from './provider.js'
import { PROVIDER_OUTPUT_CREATE } from '../__test-utils__/provider-fixtures.js'

it('should parse create output', () => {
  const plan = parseProviderOutput(PROVIDER_OUTPUT_CREATE, 'my-project')
  expect(plan.changes).toHaveLength(2)
  expect(plan.changes[0].action).toBe('create')
})
```

## Orchestration/Integration-Style Tests

For testing multi-step orchestrators that coordinate multiple subsystems:

1. Mock all dependencies at the module level
2. Use `beforeEach` with `vi.clearAllMocks()` for isolation
3. Set up preconditions with mock return values per test
4. Assert the interaction sequence: calls made, call order, arguments passed

```ts
it('should execute level 1 then level 2', async () => {
  mockGetPlan.mockResolvedValue(planWithChanges)
  let callOrder = 0
  mockApply.mockImplementation(async () => {
    callOrder++
    return callOrder === 1
      ? { network: 'dev_net' } // level 1 output
      : { db: 'localhost:5432' } // level 2 output
  })

  await executor.exec(opts)

  expect(mockApply).toHaveBeenCalledTimes(2)
  expect(ctx.findOutput('network', 'network')).toBe('dev_net')
})
```

## Gotchas

- **Zod schema coercion vs raw YAML:** If code validates with `schema.safeParse(raw)` but then uses `raw as Type` instead of `parsed.data`, the coercion transforms (e.g., `z.coerce.string()`) are NOT applied. Test against actual behavior, not schema definition.
- **Module-level singletons (mutex, registry):** These persist across tests within a file. Concurrent tests that lock a mutex may deadlock. Prefer sequential operations in tests or mock the singleton.
- **`vi.mock` hoisting:** `vi.mock()` calls are hoisted to the top of the file. Variables referenced inside the factory must be declared with `vi.fn()` at module scope — they can't reference `let` variables from `beforeEach`.
