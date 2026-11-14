// El servidor de producción: la misma API que en desarrollo pero solo con la sesión de verdad (aquí no existe «Entrar
// como»), más las pantallas ya compiladas, los encabezados de seguridad, una dirección de salud para el balanceador y
// los subdominios de cada rectificadora.
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { compress } from 'hono/compress'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import type { Base } from '../base'
import { esHttps, hostDe } from '../http'
import { identidadPorSesion } from '../modulos/acceso/sesion'
import { crearApp } from '../servidor'

export type Opciones = {
  /** «rectificadora.cl»: el sistema queda ahí y cada rectificadora también en su subdominio. */
  dominio: string
  /** La carpeta con las pantallas compiladas (`dist`). */
  pantallas: string
  /** Dónde se anota cada pedido; por omisión, la salida del proceso. */
  anotar?: (linea: string) => void
}

const UN_ANO = 'public, max-age=31536000, immutable'

/**
 * Lo que puede cargar la página. Ant Design pone sus estilos en la página misma, por eso `style-src` permite los de
 * adentro; código, en cambio, solo el de los archivos propios. Nadie puede meter el sistema en un marco ajeno.
 */
const POLITICA = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
}

export function armarProduccion(base: Base, o: Opciones) {
  const app = new Hono()

  // Para el balanceador: responde mientras la base conteste. Va antes que todo, y no se anota (llega cada pocos segundos).
  app.get('/api/salud', async (c) => {
    try {
      await base.execute(sql`select 1`)
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false, error: 'La base no responde.' }, 503)
    }
  })

  app.use(logger(o.anotar))
  app.use(secureHeaders({ contentSecurityPolicy: POLITICA, crossOriginEmbedderPolicy: false, referrerPolicy: 'same-origin' }))
  app.use(compress())

  // Cada rectificadora también se abre por su subdominio: «nuble.rectificadora.cl» lleva a «rectificadora.cl/c/nuble».
  // Así hay un solo sitio (una sola sesión y un solo certificado que importe) y la dirección corta igual sirve.
  app.use(async (c, next) => {
    if ((c.req.method !== 'GET' && c.req.method !== 'HEAD') || c.req.path.startsWith('/api/')) return next()
    const [host, puerto] = hostDe(c).split(':')
    if (!host.endsWith(`.${o.dominio}`)) return next()
    const sub = host.slice(0, -(o.dominio.length + 1))
    const { pathname, search } = new URL(c.req.url)
    const resto = pathname === '/' ? '' : pathname
    const camino = sub === 'www' ? pathname : sub.includes('.') ? '/' : sub === 'plataforma' ? `/plataforma${resto}` : `/c/${sub}${resto}`
    return c.redirect(`${esHttps(c) ? 'https' : 'http'}://${o.dominio}${puerto ? `:${puerto}` : ''}${camino}${search}`, 302)
  })

  app.route('/', crearApp(base, identidadPorSesion(base)))
  app.all('/api/*', (c) => c.json({ error: 'No existe esa dirección.' }, 404))

  // Las pantallas. Los archivos de /assets llevan su huella en el nombre: no cambian nunca y el navegador los guarda un
  // año. La página misma se pide fresca cada vez, para que una versión nueva llegue al tiro.
  app.use(
    '/assets/*',
    async (c, next) => {
      await next()
      if (c.res.status === 200) c.header('Cache-Control', UN_ANO)
    },
    serveStatic({ root: o.pantallas }),
  )
  app.get('/assets/*', (c) => c.text('No existe ese archivo.', 404))
  // Un sistema con clave no tiene nada que mostrar a los buscadores.
  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /\n'))
  // Cualquier otra dirección es de las pantallas (/c/nuble/ot/123): va la página, y el enrutador del navegador hace el
  // resto. Lo que parece un archivo (favicon.ico) y no está, no existe.
  app.get('*', async (c, next) => {
    if (/\.[a-z0-9]+$/i.test(c.req.path)) return c.text('No existe ese archivo.', 404)
    c.header('Cache-Control', 'no-cache')
    return serveStatic({ path: join(o.pantallas, 'index.html') })(c, next)
  })
  return app
}
