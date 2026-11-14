// Buscar en el registro de eventos. El alcance va aparte de los filtros a propósito: el panel de un cliente pasa su
// tenant como alcance y ningún filtro que venga del pedido puede ampliarlo.
import { and, count, desc, eq, gte, inArray, lt, notInArray, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Base } from '../../base'
import { tenants } from '../tenants/tablas'
import { platformAdmins, users } from '../usuarios/tablas'
import { events, type Evento } from './tablas'
import { CATEGORIAS, type Categoria, type Severidad, SOLO_PLATAFORMA, TIPOS_DE_EVENTO, type TipoEvento, tiposDeCategoria } from './tipos'
import { diaSchema } from '../../fecha'
import { inicioDelDiaEnChile } from '../taller/reglas'

const categorias = Object.keys(CATEGORIAS) as [Categoria, ...Categoria[]]
const tipos = Object.keys(TIPOS_DE_EVENTO) as [TipoEvento, ...TipoEvento[]]

export const filtrosEventos = z.object({
  categoria: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).filter(Boolean))
    .pipe(z.array(z.enum(categorias)))
    .optional(),
  tipo: z.enum(tipos).optional(),
  severidad: z.enum(['info', 'warning', 'error', 'critical']).optional(),
  tenant: z.string().max(40).optional(),
  usuario: z.string().max(40).optional(),
  actor: z.string().max(40).optional(),
  desde: diaSchema.optional(),
  hasta: diaSchema.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(10).max(200).default(50),
})
export type FiltrosEventos = z.infer<typeof filtrosEventos>

export type EventoVisible = Omit<Evento, 'createdAt'> & {
  createdAt: string
  nombre: string
  actorNombre: string | null
  usuarioNombre: string | null
  tenantNombre: string | null
}

/** Pone nombre a los ids: quién lo hizo (persona del cliente o del equipo), a quién y en qué cliente. */
export async function conNombres(base: Base, lista: Evento[]): Promise<EventoVisible[]> {
  const idsPersonas = [...new Set(lista.flatMap((e) => [e.userId, e.actorType === 'user' ? e.actorId : null]).filter((x): x is string => Boolean(x)))]
  const idsEquipo = [...new Set(lista.filter((e) => e.actorType === 'platform_admin' && e.actorId).map((e) => e.actorId!))]
  const idsTenants = [...new Set(lista.map((e) => e.tenantId).filter((x): x is string => Boolean(x)))]
  const [personas, equipo, clientes] = await Promise.all([
    idsPersonas.length ? base.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, idsPersonas)) : [],
    idsEquipo.length ? base.select({ id: platformAdmins.id, name: platformAdmins.name }).from(platformAdmins).where(inArray(platformAdmins.id, idsEquipo)) : [],
    idsTenants.length ? base.select({ id: tenants.id, name: tenants.name }).from(tenants).where(inArray(tenants.id, idsTenants)) : [],
  ])
  const nombre = new Map([...personas, ...equipo, ...clientes].map((x) => [x.id, x.name]))
  return lista.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    nombre: TIPOS_DE_EVENTO[e.eventType]?.nombre ?? e.eventType,
    actorNombre:
      e.actorType === 'system' ? 'Sistema' : e.actorType === 'platform_admin' ? `Equipo: ${nombre.get(e.actorId ?? '') ?? e.actorId}` : (nombre.get(e.actorId ?? '') ?? e.actorId),
    usuarioNombre: e.userId ? (nombre.get(e.userId) ?? null) : null,
    tenantNombre: e.tenantId ? (nombre.get(e.tenantId) ?? null) : null,
  }))
}

/** Para el panel del cliente: de lo que hizo alguien del equipo se ve quién y qué, no su IP ni su navegador. */
export const sinDatosDelEquipo = <E extends Pick<EventoVisible, 'actorType' | 'ipAddress' | 'userAgent'>>(lista: E[]) =>
  lista.map((e) => (e.actorType === 'platform_admin' ? { ...e, ipAddress: null, userAgent: null } : e))

/** `delCliente`: lo pide el panel del propio cliente, que no ve lo que es solo de la plataforma. */
export async function buscarEventos(base: Base, f: FiltrosEventos, alcance: { tenantId: string; delCliente?: boolean } | 'global') {
  const tiposPedidos = f.categoria?.length ? f.categoria.flatMap(tiposDeCategoria) : null
  const condiciones: (SQL | undefined)[] = [
    alcance === 'global' ? (f.tenant ? eq(events.tenantId, f.tenant) : undefined) : eq(events.tenantId, alcance.tenantId),
    alcance !== 'global' && alcance.delCliente ? notInArray(events.eventType, SOLO_PLATAFORMA) : undefined,
    tiposPedidos ? inArray(events.eventType, tiposPedidos) : undefined,
    f.tipo ? eq(events.eventType, f.tipo) : undefined,
    f.severidad ? eq(events.severity, f.severidad as Severidad) : undefined,
    f.usuario ? eq(events.userId, f.usuario) : undefined,
    f.actor ? eq(events.actorId, f.actor) : undefined,
    // Los días de Chile, como se ven en la tabla: «hasta el 14» incluye lo de las 22:00 del 14.
    f.desde ? gte(events.createdAt, inicioDelDiaEnChile(f.desde)) : undefined,
    f.hasta ? lt(events.createdAt, inicioDelDiaEnChile(new Date(Date.parse(`${f.hasta}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10))) : undefined,
  ]
  const donde = and(...condiciones)
  const [{ total }] = await base.select({ total: count() }).from(events).where(donde)
  const filas = await base
    .select()
    .from(events)
    .where(donde)
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(f.porPagina)
    .offset((f.pagina - 1) * f.porPagina)
  const visibles = await conNombres(base, filas)
  return { total, filas: alcance !== 'global' && alcance.delCliente ? sinDatosDelEquipo(visibles) : visibles }
}
