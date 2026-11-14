import '../zod-es'
import '@fontsource-variable/archivo/wdth.css'
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
    <ConfigProvider locale={esES} theme={tema}>
      <App>
        <RouterProvider router={router} />
      </App>
    </ConfigProvider>
  </QueryClientProvider>,
)
