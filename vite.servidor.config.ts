import { defineConfig } from 'vite'

// El servidor de producción, compilado aparte de las pantallas: dist-servidor/servidor.js (`npm start`) y
// dist-servidor/equipo.js (`npm run equipo`). Las dependencias no van adentro: se instalan a su lado (`npm ci --omit=dev`).
export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist-servidor',
    emptyOutDir: true,
    target: 'node24',
    copyPublicDir: false,
    rolldownOptions: { input: { servidor: 'src/produccion/servidor.ts', equipo: 'src/produccion/equipo.ts' }, output: { entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' } },
  },
})
