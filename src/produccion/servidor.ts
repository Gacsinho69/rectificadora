// Arranca el sistema en producción: `npm run build` y después `npm start`. Lee su configuración del entorno, abre la
// base PostgreSQL (le aplica las migraciones pendientes) y atiende hasta que el servidor le pida apagarse.
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { abrirPostgres } from '../base'
import { sembrarDemo } from '../modulos/demo/sembrar'
import { armarProduccion } from './app'
import { baseSinClave, type Configuracion, leerConfiguracion } from './configuracion'

let config: Configuracion
let base: Awaited<ReturnType<typeof abrirPostgres>>
try {
  config = leerConfiguracion(process.env)
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
try {
  base = await abrirPostgres(config.baseDeDatos)
} catch (e) {
  // Que se sepa en qué paso falló: la base no contesta, la clave no sirve o una migración no pasó.
  console.error(`No se pudo abrir la base ${baseSinClave(config.baseDeDatos)} ni aplicarle las migraciones: ${(e as Error).message}`)
  process.exit(1)
}
console.log(`Base lista y al día: ${baseSinClave(config.baseDeDatos)}`)

if (config.demostracion && (await sembrarDemo(base.base)))
  console.warn('DEMOSTRACION=si: la base estaba vacía y se sembró la demostración. Todas sus personas entran con la clave «demo1234»: esto es para un servidor de prueba, no para el de verdad.')

// Compilado queda en dist-servidor/, al lado de dist/ con las pantallas.
const pantallas = fileURLToPath(new URL('../dist', import.meta.url))
const app = armarProduccion(base.base, { dominio: config.dominio, pantallas })
const servidor = serve({ fetch: app.fetch, port: config.puerto }, (i) => console.log(`Rectificadora atendiendo en el puerto ${i.port} para ${config.dominio}`))

// Al apagar (una versión nueva, un reinicio): deja de recibir pedidos, termina los que están en curso y suelta la base.
let apagando = false
function apagar(senal: string) {
  if (apagando) return
  apagando = true
  console.log(`${senal}: apagando…`)
  setTimeout(() => process.exit(1), 10_000).unref()
  servidor.close(() => void base.cerrar().finally(() => process.exit(0)))
}
process.on('SIGTERM', () => apagar('SIGTERM'))
process.on('SIGINT', () => apagar('SIGINT'))
