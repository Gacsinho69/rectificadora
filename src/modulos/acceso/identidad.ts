// Quién pide. Hay dos clases de personas y nunca se mezclan: el equipo de la plataforma (acceso global, consola) y
// las personas de cada cliente (solo su cliente). Quien está impersonando sigue siendo del equipo: la consola lo ve
// como tal, y solo el panel del cliente lo trata como el administrador al que impersona, dejando su nombre en la auditoría.
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import type { Base } from '../../base'
import { impersonations } from '../soporte/tablas'
import { type EstadoTenant, type Funcion, funcionesDe } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import type { RolTenant } from '../usuarios/reglas'
import { platformAdmins, users } from '../usuarios/tablas'
import type { PermisoPlataforma } from './permisos'

export type AdminPlataforma = { tipo: 'plataforma'; id: string; nombre: string; correo: string; permisos: PermisoPlataforma[] }

export type PersonaDelTenant = {
  tipo: 'tenant'
  id: string
  nombre: string
  correo: string
  tenantId: string
  tenantNombre: string
  /** El subdominio: la dirección de su portal. */
  tenantSlug: string
  estadoTenant: EstadoTenant
  rol: RolTenant
  /** Los módulos que tiene encendidos su organización (compras, bodega, máquinas). */
  funciones: Funcion[]
  /** Presente cuando quien actúa es alguien del equipo entrando como esta persona. */
  impersonacion?: { id: string; adminId: string; adminNombre: string; motivo: string; vence: string }
}

export type Actor = AdminPlataforma | PersonaDelTenant

/** Cómo se sabe quién pide. En desarrollo y en las pruebas, por la cookie `como`; en producción, la sesión del portal. */
export type Identidad = (c: Context) => Promise<Actor | null>

export async function adminPorId(base: Base, id: string): Promise<AdminPlataforma | null> {
  const [a] = await base.select().from(platformAdmins).where(and(eq(platformAdmins.id, id), eq(platformAdmins.active, true)))
  return a ? { tipo: 'plataforma', id: a.id, nombre: a.name, correo: a.email, permisos: a.permissions } : null
}

/** Una persona activa de un cliente que no esté cancelado. Bloqueados e invitados no entran. */
export async function personaPorId(base: Base, id: string): Promise<PersonaDelTenant | null> {
  const [p] = await base
    .select({ u: users, t: { name: tenants.name, slug: tenants.slug, status: tenants.status, banderas: tenants.featureFlags } })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(eq(users.id, id), eq(users.status, 'active')))
  if (!p || p.t.status === 'cancelled') return null
  return { tipo: 'tenant', id: p.u.id, nombre: p.u.name, correo: p.u.email, tenantId: p.u.tenantId, tenantNombre: p.t.name, tenantSlug: p.t.slug, estadoTenant: p.t.status, rol: p.u.role, funciones: funcionesDe(p.t.banderas) }
}

/**
 * Solo para desarrollo y pruebas: la cookie `como` dice quién es, sin clave. En producción se reemplaza por la sesión
 * firmada del portal; el resto de la app no cambia, porque solo conoce el `Actor`.
 */
export const identidadPorCookie =
  (base: Base): Identidad =>
  async (c) => {
    const id = getCookie(c, 'como')
    if (!id) return null
    if (id.startsWith('adm_')) return adminPorId(base, id)
    if (id.startsWith('us_')) return personaPorId(base, id)
    return null
  }

/** Si alguien del equipo tiene una impersonación abierta y vigente, la persona como la que actúa; si no, null. */
export async function impersonacionVigente(base: Base, c: Context, admin: AdminPlataforma, ahora: Date): Promise<PersonaDelTenant | null> {
  const id = getCookie(c, 'impersonacion')
  if (!id) return null
  const [imp] = await base
    .select()
    .from(impersonations)
    .where(and(eq(impersonations.id, id), eq(impersonations.adminId, admin.id), isNull(impersonations.endedAt), gt(impersonations.expiresAt, ahora)))
  if (!imp) return null
  const persona = await personaPorId(base, imp.userId)
  if (!persona || persona.tenantId !== imp.tenantId) return null
  return { ...persona, impersonacion: { id: imp.id, adminId: admin.id, adminNombre: admin.nombre, motivo: imp.reason, vence: imp.expiresAt.toISOString() } }
}
