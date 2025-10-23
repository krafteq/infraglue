#!/usr/bin/env node

/**
 * CLI wrapper for a binary tool.
 *
 * - In local dev: runs ../src/index.ts via tsx (if available).
 * - In production: runs ../dist/index.js directly in the same process.
 *
 * Paths are resolved relative to this wrapper script, not cwd.
 */

import { existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, resolve } from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const tsPath = resolve(__dirname, '../src/index.ts')
const jsPath = resolve(__dirname, '../dist/index.js')
const args = process.argv.slice(2)

const canUseTsNode = () => {
  if (!existsSync(tsPath)) return false
  try {
    require.resolve('tsx')
    return true
  } catch {
    return false
  }
}

if (canUseTsNode()) {
  const result = spawnSync('pnpm', ['exec', 'tsx', tsPath, ...args], {
    stdio: 'inherit',
    cwd: resolve(__dirname, '..'),
    env: {
      ...process.env,
      __DEV_CWD: process.cwd(),
    },
  })
  process.exit(result.status ?? 1)
} else if (existsSync(jsPath)) {
  await import(pathToFileURL(jsPath))
} else {
  console.error('Error: Could not find entry point.\n' + `Checked:\n  - ${tsPath}\n  - ${jsPath}`)
  process.exit(1)
}
