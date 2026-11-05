import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import base from './vitest.config'

// Focused runner for the four security acceptance probes; these also run in the full suite.
export default defineConfig({
  ...base,
  root: __dirname,
  cacheDir: '.cache/review',
  test: {
    ...base.test,
    include: ['src/__review__/*.spec.ts'],
    setupFiles: [resolve(__dirname, 'src/__tests__/setup.ts')]
  }
})
