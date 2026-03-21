import { describe, it, expect } from 'vitest'
import { execFile, exec } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

/**
 * These tests prove that execFile (no shell) preserves special characters in arguments,
 * while exec (shell: true) corrupts them. This validates the fix in setPulumiConfig
 * which switched from exec to execFile for `pulumi config set` calls.
 */
describe('shell safety: execFile vs exec with special characters', () => {
  const specialValues = [
    { name: 'ampersand', value: 'p@ss&word' },
    { name: 'dollar sign', value: 'price$100' },
    { name: 'backtick', value: 'run`cmd`now' },
    { name: 'caret', value: 'up^down' },
    { name: 'mixed symbols', value: 'p@ss^w&rd$100!' },
    { name: 'single quotes', value: "it's a test" },
    { name: 'double quotes', value: 'say "hello"' },
    { name: 'parentheses', value: 'fn(arg)' },
    { name: 'semicolon', value: 'a;b' },
    { name: 'pipe', value: 'a|b' },
    { name: 'spaces and tabs', value: 'hello\tworld  here' },
  ]

  describe('execFile passes special characters safely (no shell)', () => {
    for (const { name, value } of specialValues) {
      it(`preserves ${name}: ${value}`, async () => {
        // printf %s prints the argument exactly as-is, no interpretation
        const { stdout } = await execFileAsync('printf', ['%s', value])
        expect(stdout).toBe(value)
      })
    }
  })

  describe('exec corrupts special characters (shell interpretation)', () => {
    it('ampersand causes command to be backgrounded / split', async () => {
      // `echo p@ss&word` — the shell interprets & as a command separator
      // This may error or produce truncated output
      try {
        const { stdout } = await execAsync('printf %s p@ss&word')
        // If it doesn't error, the output will be wrong (truncated at &)
        expect(stdout).not.toBe('p@ss&word')
      } catch {
        // Error is expected — `word` is treated as a separate command
      }
    })

    it('dollar sign triggers variable expansion', async () => {
      const { stdout } = await execAsync('printf %s price$NONEXISTENT_VAR')
      // $NONEXISTENT_VAR expands to empty string
      expect(stdout).toBe('price')
      expect(stdout).not.toBe('price$NONEXISTENT_VAR')
    })

    it('backtick triggers command substitution', async () => {
      // `echo run`cmd`now` — backticks cause command substitution
      try {
        const { stdout } = await execAsync('printf %s run`echo injected`now')
        // Shell substitutes `echo injected` → "injected"
        expect(stdout).not.toBe('run`echo injected`now')
      } catch {
        // May error if the substituted command fails
      }
    })
  })
})
