import '../zod-es'
// Las letras del sistema de diseño (IBM Plex), servidas desde la app: el texto, los rótulos angostos y las cifras.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans-condensed/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import 'antd/dist/reset.css'
import './estilo.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { App, ConfigProvider } from 'antd'
import esES from 'antd/locale/es_ES'
import { createRoot } from 'react-dom/client'
import { Rechazo } from './api'
import { router } from './rutas'
import { tema } from './tema'

// Lo que llega del servidor se guarda aquí; se pide de nuevo si tiene más de 30 segundos o al volver a la ventana.
// Lo que el servidor rechazó (no existe, sin permiso) no se reintenta.
const consultas = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (veces, e) => veces < 1 && !(e instanceof Rechazo && e.estado < 500) },
  },
})

createRoot(document.getElementById('raiz') as HTMLElement).render(
  <QueryClientProvider client={consultas}>
    <ConfigProvider locale={esES} theme={tema} wave={{ disabled: true }}>
      <App>
        <RouterProvider router={router} />
      </App>
    </ConfigProvider>
  </QueryClientProvider>,
)
