import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  cacheDir: '.cache/vitest',
  plugins: [vue()],
  // Real lazy-page imports include the public compliance Markdown outside
  // frontend/. Keep that narrow source directory available in the test server.
  server: { fs: { allow: [resolve(__dirname), resolve(__dirname, '../docs/legal')] } },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '/app-assets': resolve(__dirname, 'public/app-assets'),
      'vue-i18n': 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js'
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.{js,ts,vue}'],
      exclude: [
        'node_modules',
        'src/**/*.d.ts',
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/main.ts'
      ],
      thresholds: {
        // Vitest treats nested keys as file globs. A nested `global` object
        // matches no source files and silently bypasses the intended gate.
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      }
    }
  }
})
