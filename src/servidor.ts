// La API: identifica a quien pide, monta la consola del equipo y el panel del cliente, y responde los errores en
// castellano. Un error no previsto queda además como `system.error` en el registro: así aparece en «Errores recientes».
import { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import type { Base } from './base'
import type { Entorno } from './http'
import { impersonacionVigente, type Identidad } from './modulos/acceso/identidad'
import { rutasAcceso } from './modulos/acceso/rutas'
import { cerrarSesion } from './modulos/acceso/sesion'
import { origenDe, registrar, SISTEMA } from './modulos/eventos/registrar'
import { rutasOrganizacion } from './modulos/organizacion/rutas'
import { rutasPlataforma } from './modulos/plataforma/rutas'
import { rutasTaller } from './modulos/taller/rutas'

export type Reloj = () => Date

export function crearApp(base: Base, identidad: Identidad, reloj: Reloj = () => new Date()) {
  const app = new Hono<Entorno>()

  app.use('/api/*', async (c, next) => {
    c.set('base', base)
    c.set('ahora', reloj())
    const actor = await identidad(c)
    if (actor) c.set('actor', actor)
    await next()
  })

  app.onError(async (e, c) => {
    if (e instanceof HTTPException) return c.json({ error: e.message }, e.status)
    console.error(e)
    const actor = c.get('actor')
    await registrar(base, actor ? origenDe(c, actor) : SISTEMA, {
      tenantId: actor?.tipo === 'tenant' ? actor.tenantId : null,
      eventType: 'system.error',
      metadata: { ruta: c.req.path, metodo: c.req.method, mensaje: String((e as Error).message ?? e).slice(0, 500) },
    }).catch(() => {})
    return c.json({ error: 'Algo falló de nuestro lado. Ya quedó registrado; vuelve a intentar en un momento.' }, 500)
  })

  /** Quién soy, y si estoy entrando como alguien de un cliente. Las pantallas eligen la consola o el panel con esto. */
  app.get('/api/yo', async (c) => {
    const actor = c.get('actor')
    if (!actor) return c.json({ actor: null, impersonacion: null })
    const impersonacion = actor.tipo === 'plataforma' ? await impersonacionVigente(base, c, actor, c.var.ahora) : null
    return c.json({ actor, impersonacion })
  })

  /** Salir: cierra la sesión de este navegador (y, en desarrollo, deja de «entrar como»). */
  app.post('/api/salir', async (c) => {
    await cerrarSesion(c, base, c.var.ahora)
    deleteCookie(c, 'como', { path: '/' })
    deleteCookie(c, 'impersonacion', { path: '/' })
    return c.json({ ok: true })
  })

  app.route('/api', rutasAcceso)

  app.route('/api/plataforma', rutasPlataforma)
  app.route('/api/organizacion', rutasOrganizacion)
  app.route('/api/servicio', rutasTaller)
  return app
}
