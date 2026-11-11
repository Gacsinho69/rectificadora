// Las guardias de la API. El aislamiento entre clientes descansa en tres reglas:
// 1. El portal y el panel del cliente toman el tenant SOLO del actor (su sesión), nunca de lo que diga el pedido.
// 2. Todo lo que el pedido nombra por id (un usuario, una OT, una cotización) se busca dentro de ese tenant.
// 3. Si lo nombrado existe pero es de otro cliente, si se abre el portal de otro cliente, o si alguien de un cliente
//    pide la consola global, se responde como si no existiera (o sin permiso) y queda un evento crítico
//    `security.cross_tenant_access_attempt`.
import { eq } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { Context, MiddlewareHandler } from 'hono'
import { type Entorno, rechazo } from '../../http'
import { origenDe, registrar } from '../eventos/registrar'
import { users } from '../usuarios/tablas'
import { type AdminPlataforma, impersonacionVigente, type PersonaDelTenant } from './identidad'
import { PERMISOS_PLATAFORMA, type PermisoPlataforma } from './permisos'

export type EntornoPlataforma = { Variables: Entorno['Variables'] & { actor: AdminPlataforma } }
export type EntornoTenant = { Variables: Entorno['Variables'] & { actor: PersonaDelTenant } }

async function anotarCrossTenant(c: Context, metadata: Record<string, unknown>, objetivo?: { id: string; tipo: string; userId?: string }) {
  const { actor, base } = c.var as Entorno['Variables']
  await registrar(base, origenDe(c), {
    tenantId: actor.tipo === 'tenant' ? actor.tenantId : null,
    eventType: 'security.cross_tenant_access_attempt',
    userId: objetivo?.userId ?? (actor.tipo === 'tenant' ? actor.id : null),
    targetId: objetivo?.id ?? null,
    targetType: objetivo?.tipo ?? null,
    metadata: { metodo: c.req.method, ruta: c.req.path, ...metadata },
  })
}

/** La consola global: solo el equipo de la plataforma. Una persona de un cliente que llega aquí queda anotada. */
export const soloEquipo: MiddlewareHandler<Entorno> = async (c, next) => {
  const actor = c.get('actor')
  if (!actor) throw rechazo(401, 'Inicia sesión para continuar.')
  if (actor.tipo !== 'plataforma') {
    await anotarCrossTenant(c, { motivo: 'consola_global' })
    throw rechazo(403, 'No tienes acceso a la consola de la plataforma.')
  }
  await next()
}

/**
 * Las acciones sensibles piden su permiso aparte. La negativa también queda anotada: un intento repetido de quien no
 * debe es algo que seguridad quiere ver.
 */
export async function exigirPermiso(c: Context<EntornoPlataforma>, permiso: PermisoPlataforma, tenantId: string | null) {
  if (c.var.actor.permisos.includes(permiso)) return
  await registrar(c.var.base, origenDe(c), {
    tenantId,
    eventType: 'security.permission_denied',
    metadata: { permiso, ruta: c.req.path },
  })
  throw rechazo(403, `Te falta el permiso «${PERMISOS_PLATAFORMA[permiso]}».`)
}

/**
 * Quién actúa dentro de un cliente: una persona de ese cliente, o alguien del equipo con una impersonación vigente
 * (que actúa como esa persona). El tenant sale de aquí y de ninguna otra parte. Un pedido que intenta elegir otro
 * tenant (por encabezado o por la dirección) o que viene del portal de otro cliente (`x-portal`) no se atiende, y queda
 * anotado.
 */
async function actorDelTenant(c: Context<Entorno>, sinImpersonar: string): Promise<PersonaDelTenant> {
  let actor = c.get('actor')
  if (!actor) throw rechazo(401, 'Inicia sesión para continuar.')
  if (actor.tipo === 'plataforma') {
    const como = await impersonacionVigente(c.var.base, c, actor, c.var.ahora)
    if (!como) throw rechazo(403, sinImpersonar)
    actor = como
    c.set('actor', actor)
  }
  const pedido = c.req.header('x-tenant-id') ?? c.req.query('tenant_id') ?? c.req.query('tenantId')
  if (pedido && pedido !== actor.tenantId) {
    await anotarCrossTenant(c, { tenant_pedido: pedido }, { id: pedido, tipo: 'tenant' })
    throw rechazo(403, 'Solo puedes ver los datos de tu organización.')
  }
  const portal = c.req.header('x-portal')
  if (portal && portal !== actor.tenantSlug) {
    await anotarCrossTenant(c, { portal_pedido: portal, motivo: 'portal_de_otro_cliente' }, { id: portal, tipo: 'portal' })
    throw rechazo(403, 'Este portal es de otra organización.')
  }
  return actor
}

/** El panel de administración del cliente: solo su administrador (o soporte entrando como él). */
export const soloAdminDelTenant: MiddlewareHandler<Entorno> = async (c, next) => {
  const actor = await actorDelTenant(c, 'El panel del cliente se abre entrando como su administrador, desde la ficha del cliente.')
  if (actor.rol !== 'admin') throw rechazo(403, 'Solo el administrador de tu organización puede abrir este panel.')
  await next()
}

/** El portal del cliente: cualquier persona activa de ese cliente (o soporte entrando como su administrador). */
export const soloPersonaDelTenant: MiddlewareHandler<Entorno> = async (c, next) => {
  await actorDelTenant(c, 'El portal de un cliente se abre entrando como su administrador, desde la ficha del cliente.')
  await next()
}

/** Las acciones del cliente sobre su gente no corren con el cliente suspendido o cancelado: solo puede mirar. */
export function exigirTenantOperativo(c: Context<EntornoTenant>) {
  if (c.var.actor.estadoTenant === 'suspended' || c.var.actor.estadoTenant === 'cancelled')
    throw rechazo(403, 'Tu organización está suspendida: puedes revisar, pero no hacer cambios.')
}

/**
 * Una fila del propio cliente, buscada por id en cualquier tabla con `tenantId`. Si es de otro cliente se responde
 * «no existe» y queda el intento anotado: quien prueba ids ajenos no aprende si existen.
 */
export async function filaDelTenant<T extends PgTable & { id: PgColumn; tenantId: PgColumn }>(c: Context<EntornoTenant>, tabla: T, id: string, tipo: string, nombre: string) {
  const [fila] = (await c.var.base.select().from(tabla as PgTable).where(eq(tabla.id, id))) as (T['$inferSelect'] & { tenantId: string })[]
  if (!fila) throw rechazo(404, `No existe ${nombre}.`)
  if (fila.tenantId !== c.var.actor.tenantId) {
    await anotarCrossTenant(c, { tenant_objetivo: fila.tenantId }, { id, tipo })
    throw rechazo(404, `No existe ${nombre}.`)
  }
  return fila
}

/** Un usuario del propio cliente. */
export const usuarioDelTenant = (c: Context<EntornoTenant>, id: string) => filaDelTenant(c, users, id, 'user', 'ese usuario')

/** Ver no es lo mismo que cambiar: el rol «Solo lectura» mira el portal, pero no crea ni modifica. */
export function exigirQuePuedaEditar(c: Context<EntornoTenant>) {
  exigirTenantOperativo(c)
  if (c.var.actor.rol === 'viewer') throw rechazo(403, 'Tu rol es de solo lectura.')
}
