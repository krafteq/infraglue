import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['packages/**/src/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 10000,
  },
})
