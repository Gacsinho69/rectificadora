// La API: identifica a quien pide, monta la consola del equipo y el panel del cliente, y responde los errores en
// castellano. Un error no previsto queda además como `system.error` en el registro: así aparece en «Errores recientes».
import './zod-es'
import { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import type { Base } from './base'
import { bodyLimit } from 'hono/body-limit'
import { type Entorno, mismoSitio } from './http'
import { impersonacionVigente, type Identidad } from './modulos/acceso/identidad'
import { rutasAcceso } from './modulos/acceso/rutas'
import { cerrarSesion } from './modulos/acceso/sesion'
import { origenDe, registrar, SISTEMA } from './modulos/eventos/registrar'
import { rutasOrganizacion } from './modulos/organizacion/rutas'
import { rutasPlataforma } from './modulos/plataforma/rutas'
import { rutasTaller } from './modulos/taller/rutas'

export type Reloj = () => Date

/**
 * Lo que se anota de un error: el motivo, sin la consulta ni sus valores. El error de una consulta trae los parámetros
 * (un hash de clave, un correo); el de la base que va dentro (`cause`) dice lo mismo sin ellos.
 */
export function mensajeDeError(e: unknown): string {
  const causa = (e as { cause?: { message?: string } })?.cause?.message
  const texto = causa ?? String((e as Error)?.message ?? e)
  return texto.replace(/\s*params:[\s\S]*$/i, '').slice(0, 500)
}

export function crearApp(base: Base, identidad: Identidad, reloj: Reloj = () => new Date()) {
  const app = new Hono<Entorno>()

  app.use('/api/*', mismoSitio, bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: 'Lo enviado es demasiado grande (más de 1 MB).' }, 413) }))
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
      metadata: { ruta: c.req.path, metodo: c.req.method, mensaje: mensajeDeError(e) },
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
