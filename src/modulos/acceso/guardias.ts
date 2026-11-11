// Las guardias de la API. El aislamiento entre clientes descansa en tres reglas:
// 1. El panel del cliente toma el tenant SOLO del actor (su sesión), nunca de lo que diga el pedido.
// 2. Todo lo que el pedido nombra por id (un usuario, una clave) se busca dentro de ese tenant.
// 3. Si lo nombrado existe pero es de otro cliente, o alguien de un cliente pide la consola global, se responde como
//    si no existiera (o sin permiso) y queda un evento crítico `security.cross_tenant_access_attempt`.
import { eq } from 'drizzle-orm'
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
 * El panel del cliente: su administrador, o alguien del equipo con una impersonación vigente (que actúa como ese
 * administrador). El tenant sale de aquí y de ninguna otra parte.
 */
export const soloAdminDelTenant: MiddlewareHandler<Entorno> = async (c, next) => {
  let actor = c.get('actor')
  if (!actor) throw rechazo(401, 'Inicia sesión para continuar.')
  if (actor.tipo === 'plataforma') {
    const como = await impersonacionVigente(c.var.base, c, actor, c.var.ahora)
    if (!como) throw rechazo(403, 'El panel del cliente se abre entrando como su administrador, desde la ficha del cliente.')
    actor = como
    c.set('actor', actor)
  }
  if (actor.rol !== 'admin') throw rechazo(403, 'Solo el administrador de tu organización puede abrir este panel.')
  // Un pedido que intenta elegir otro tenant (por encabezado o por la dirección) no se atiende, y queda anotado.
  const pedido = c.req.header('x-tenant-id') ?? c.req.query('tenant_id') ?? c.req.query('tenantId')
  if (pedido && pedido !== actor.tenantId) {
    await anotarCrossTenant(c, { tenant_pedido: pedido }, { id: pedido, tipo: 'tenant' })
    throw rechazo(403, 'Solo puedes ver los datos de tu organización.')
  }
  await next()
}

/** Las acciones del cliente sobre su gente no corren con el cliente suspendido o cancelado: solo puede mirar. */
export function exigirTenantOperativo(c: Context<EntornoTenant>) {
  if (c.var.actor.estadoTenant === 'suspended' || c.var.actor.estadoTenant === 'cancelled')
    throw rechazo(403, 'Tu organización está suspendida: puedes revisar, pero no hacer cambios.')
}

/** Un usuario del propio cliente. Si es de otro cliente se responde «no existe» y queda el intento anotado. */
export async function usuarioDelTenant(c: Context<EntornoTenant>, id: string) {
  const [u] = await c.var.base.select().from(users).where(eq(users.id, id))
  if (!u) throw rechazo(404, 'No existe ese usuario.')
  if (u.tenantId !== c.var.actor.tenantId) {
    await anotarCrossTenant(c, { tenant_objetivo: u.tenantId }, { id: u.id, tipo: 'user' })
    throw rechazo(404, 'No existe ese usuario.')
  }
  return u
}
