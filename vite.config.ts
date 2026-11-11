import devServer from '@hono/vite-dev-server'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En desarrollo la API corre dentro de Vite: todo lo que empieza con /api lo atiende Hono.
export default defineConfig({
  plugins: [react(), devServer({ entry: 'src/desarrollo.ts', exclude: [/^(?!\/api(?:\/|$)).*/] })],
  server: { port: 5180, watch: { ignored: ['**/.datos/**'] } },
})
