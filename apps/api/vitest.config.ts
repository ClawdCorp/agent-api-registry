import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts', 'scripts/__tests__/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    env: {
      AAR_MASTER_KEY: 'a'.repeat(64),
      AAR_DB_PATH: ':memory:',
    },
  },
})
