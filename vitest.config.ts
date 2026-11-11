import { defineConfig } from 'vitest/config'

// Cada prueba arma su base PGlite en memoria: dos procesos evitan agotar memoria.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node', testTimeout: 30_000, maxWorkers: 2, pool: 'forks' } })
