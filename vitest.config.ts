import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    // Run under Electron-as-Node (see package.json test scripts) so the better-sqlite3 native
    // module — built for Electron's ABI — loads. Forks keep the native addon isolated per worker.
    pool: 'forks',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared')
    }
  }
})
