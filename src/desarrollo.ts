// En desarrollo: la base queda en .datos/desarrollo (o donde diga BASE_DESARROLLO) y al partir vacía se siembra la
// demostración. Se entra con correo y clave (todas las personas de la demostración tienen la clave «demo1234») o con
// «Entrar como» (cookie `como`, sin clave), que existe solo aquí para probar cada perfil.
// Vite recarga este archivo con cada cambio; la base se abre una vez.
import { and, asc, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { abrirBase, type Base } from './base'
import { ipDe } from './http'
import { identidadPorCookie, personaPorId } from './modulos/acceso/identidad'
import { identidadPorSesion, primeraQueReconozca } from './modulos/acceso/sesion'
import { sembrarDemo } from './modulos/demo/sembrar'
import { registrar } from './modulos/eventos/registrar'
import { tenants } from './modulos/tenants/tablas'
import { platformAdmins, users } from './modulos/usuarios/tablas'
import { crearApp } from './servidor'

if (process.env.NODE_ENV === 'production') throw new Error('desarrollo.ts no corre en producción: «Entrar como» no pide clave.')

async function preparar(): Promise<Base> {
  const base = await abrirBase(process.env.BASE_DESARROLLO ?? '.datos/desarrollo')
  const inicio = Date.now()
  if (await sembrarDemo(base)) console.log(`Demostración sembrada en ${((Date.now() - inicio) / 1000).toFixed(1)} s`)
  return base
}

const memoria = globalThis as { baseDeDesarrollo?: Promise<Base> }
memoria.baseDeDesarrollo ??= preparar().catch((e) => {
  memoria.baseDeDesarrollo = undefined
  throw e
})
const base = await memoria.baseDeDesarrollo

const app = new Hono()

/** Para «Entrar como»: el equipo, y el administrador y un usuario de algunos clientes. */
app.get('/api/desarrollo/personas', async (c) => {
  const equipo = await base.select({ id: platformAdmins.id, nombre: platformAdmins.name, correo: platformAdmins.email, permisos: platformAdmins.permissions }).from(platformAdmins).orderBy(asc(platformAdmins.createdAt), asc(platformAdmins.name))
  const clientes = await base
    .select({ id: users.id, nombre: users.name, correo: users.email, rol: users.role, tenant: tenants.name, estadoTenant: tenants.status })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(users.status, 'active'), inArray(tenants.status, ['active', 'trial', 'past_due', 'suspended'])))
    .orderBy(asc(tenants.name), asc(users.role), asc(users.name))
  // Una persona de cada rol por cliente basta para probar.
  const vistos = new Set<string>()
  const porCliente = clientes.filter((u) => {
    const clave = `${u.tenant}:${u.rol}`
    if (vistos.has(clave)) return false
    vistos.add(clave)
    return true
  })
  return c.json({ equipo, clientes: porCliente })
})

/** Entrar como alguien. Si es de un cliente, queda su inicio de sesión como si hubiera entrado con su clave. */
app.post('/api/desarrollo/entrar', async (c) => {
  const { id } = await c.req.json<{ id: string }>()
  if (id.startsWith('us_')) {
    const persona = await personaPorId(base, id)
    if (!persona) return c.json({ error: 'Esa persona no puede entrar.' }, 403)
    const ip = ipDe(c) ?? '127.0.0.1'
    await base.transaction(async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date(), lastLoginIp: ip }).where(eq(users.id, id))
      await registrar(tx, { actorId: id, actorType: 'user', ipAddress: ip, userAgent: c.req.header('user-agent') ?? null }, {
        tenantId: persona.tenantId,
        eventType: 'user.login',
        userId: id,
        metadata: { pais: 'Chile', ciudad: 'Desarrollo', metodo: 'entrar_como' },
      })
    })
  }
  setCookie(c, 'como', id, { path: '/', httpOnly: true, sameSite: 'Lax' })
  return c.json({ ok: true })
})

// La sesión de verdad (correo y clave) y, si no hay, «Entrar como».
app.route('/', crearApp(base, primeraQueReconozca(identidadPorSesion(base), identidadPorCookie(base))))

export default app
