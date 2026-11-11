// Lo que leen la consola y el panel del cliente sobre UN cliente. Cada función recibe el tenant ya decidido por quien
// la llama (la consola, del pedido; el panel del cliente, de su sesión) y filtra todo por él.
import { and, asc, count, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Base } from '../../base'
import { conNombres, type EventoVisible } from '../eventos/consulta'
import { events } from '../eventos/tablas'
import { CATEGORIAS_DE_AUDITORIA, type TipoEvento, tiposDeCategoria } from '../eventos/tipos'
import { invoices } from '../facturacion/tablas'
import { apiKeys, integrations } from '../integraciones/tablas'
import { USOS_CLAVE, type UsoClave } from '../tenants/reglas'
import { usageDaily } from '../uso/tablas'
import { users } from '../usuarios/tablas'
import { cuenta, diaDe, hace, ts } from './panorama'

/** «190.45.12.7» → «190.45.x.x». La IP completa es dato personal: se ve con permiso y queda anotado. */
export function ocultarIp(ip: string | null): string | null {
  if (!ip) return ip
  if (ip.includes(':')) return `${ip.split(':').slice(0, 2).join(':')}:…`
  const partes = ip.split('.')
  return partes.length === 4 ? `${partes[0]}.${partes[1]}.x.x` : 'x.x.x.x'
}

export const ocultarIps = (lista: EventoVisible[], completo: boolean) => (completo ? lista : lista.map((e) => ({ ...e, ipAddress: ocultarIp(e.ipAddress) })))

const ultimos = async (base: Base, tenantId: string, tipos: TipoEvento[], limite = 30, extra?: ReturnType<typeof sql>) =>
  conNombres(
    base,
    await base
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), inArray(events.eventType, tipos), extra))
      .orderBy(desc(events.createdAt))
      .limit(limite),
  )

export async function usuariosDelTenant(base: Base, tenantId: string) {
  const lista = await base.select().from(users).where(eq(users.tenantId, tenantId)).orderBy(asc(users.status), asc(users.name))
  return lista.map((u) => ({
    id: u.id,
    nombre: u.name,
    correo: u.email,
    rol: u.role,
    estado: u.status,
    mfa: u.mfaEnabled,
    ultimoLogin: u.lastLoginAt?.toISOString() ?? null,
    ultimaIp: u.lastLoginIp,
    invitado: u.invitedAt?.toISOString() ?? null,
    bloqueado: u.blockedAt?.toISOString() ?? null,
    creado: u.createdAt.toISOString(),
  }))
}
export type UsuarioVisible = Awaited<ReturnType<typeof usuariosDelTenant>>[number]

/** Ingresos, fallidos, usuarios distintos y operaciones por día (UTC), de los últimos `dias`. */
export async function actividadPorDia(base: Base, ahora: Date, dias: number, tenantId?: string) {
  const dia = sql<string>`to_char(${events.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`
  const filas = await base
    .select({
      dia,
      logins: cuenta(sql`${events.eventType} = 'user.login'`),
      usuarios: sql<number>`count(distinct ${events.userId}) filter (where ${events.eventType} = 'user.login')`.mapWith(Number),
      fallidos: cuenta(sql`${events.eventType} = 'user.failed_login'`),
      operaciones: cuenta(sql`${events.eventType} in ('work_order.created', 'work_order.closed', 'work_order.cancelled', 'quote.sent', 'quote.accepted', 'quote.rejected')`),
    })
    .from(events)
    .where(and(gte(events.createdAt, hace(ahora, dias)), tenantId ? eq(events.tenantId, tenantId) : undefined))
    .groupBy(dia)
  const porDia = new Map(filas.map((f) => [f.dia, f]))
  // Todos los días, también los sin nada: un hueco en el gráfico es información.
  return Array.from({ length: dias }, (_, i) => {
    const d = diaDe(hace(ahora, dias - 1 - i))
    return porDia.get(d) ?? { dia: d, logins: 0, usuarios: 0, fallidos: 0, operaciones: 0 }
  })
}

export async function actividadDelTenant(base: Base, ahora: Date, tenantId: string) {
  const auditables = CATEGORIAS_DE_AUDITORIA.flatMap(tiposDeCategoria)
  const [porDia, logins, fallidos, acciones, operaciones, sinActividad] = await Promise.all([
    actividadPorDia(base, ahora, 90, tenantId),
    ultimos(base, tenantId, ['user.login']),
    ultimos(base, tenantId, ['user.failed_login']),
    ultimos(base, tenantId, auditables, 30, sql`${events.actorType} in ('user', 'platform_admin')`),
    ultimos(base, tenantId, tiposDeCategoria('operacion')),
    base
      .select({ id: users.id, nombre: users.name, correo: users.email, rol: users.role, ultimoLogin: users.lastLoginAt })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'), sql`(${users.lastLoginAt} is null or ${users.lastLoginAt} < ${ts(hace(ahora, 30))})`))
      .orderBy(sql`${users.lastLoginAt} asc nulls first`),
  ])
  return { porDia, logins, fallidos, acciones, operaciones, sinActividad }
}

export async function usoDelTenant(base: Base, ahora: Date, tenantId: string) {
  const serie = await base
    .select()
    .from(usageDaily)
    .where(and(eq(usageDaily.tenantId, tenantId), gte(usageDaily.day, diaDe(hace(ahora, 90)))))
    .orderBy(asc(usageDaily.day))
  const [totales] = await base
    .select({
      api: sql<number>`coalesce(sum(${usageDaily.apiCalls}), 0)`.mapWith(Number),
      ots: sql<number>`coalesce(sum(${usageDaily.workOrders}), 0)`.mapWith(Number),
      cotizaciones: sql<number>`coalesce(sum(${usageDaily.quotes}), 0)`.mapWith(Number),
      documentos: sql<number>`coalesce(sum(${usageDaily.documents}), 0)`.mapWith(Number),
      mensajes: sql<number>`coalesce(sum(${usageDaily.messages}), 0)`.mapWith(Number),
    })
    .from(usageDaily)
    .where(eq(usageDaily.tenantId, tenantId))
  const desde30 = diaDe(hace(ahora, 30))
  const funciones = (Object.keys(USOS_CLAVE) as UsoClave[]).map((clave) => ({
    clave,
    nombre: USOS_CLAVE[clave],
    usos30d: serie.filter((d) => d.day >= desde30).reduce((suma, d) => suma + (d.features[clave] ?? 0), 0),
  }))
  return {
    serie: serie.map((d) => ({ dia: d.day, api: d.apiCalls, almacenamiento: d.storageMb, ots: d.workOrders, cotizaciones: d.quotes, documentos: d.documents, mensajes: d.messages })),
    totales,
    funciones,
  }
}

export async function facturasDelTenant(base: Base, tenantId: string) {
  const lista = await base.select().from(invoices).where(eq(invoices.tenantId, tenantId)).orderBy(desc(invoices.issuedAt)).limit(24)
  return lista.map((f) => ({
    id: f.id,
    numero: f.number,
    periodo: f.periodStart.toISOString(),
    monto: f.amount,
    estado: f.status,
    emitida: f.issuedAt.toISOString(),
    vence: f.dueAt.toISOString(),
    pagada: f.paidAt?.toISOString() ?? null,
    motivoFalla: f.failureReason,
  }))
}

export async function integracionesDelTenant(base: Base, tenantId: string) {
  const [claves, conexiones] = await Promise.all([
    base.select().from(apiKeys).where(eq(apiKeys.tenantId, tenantId)).orderBy(desc(apiKeys.createdAt)),
    base.select().from(integrations).where(eq(integrations.tenantId, tenantId)).orderBy(asc(integrations.kind)),
  ])
  const iso = (d: Date | null) => d?.toISOString() ?? null
  return {
    clavesApi: claves.map((k) => ({ id: k.id, nombre: k.name, prefijo: k.prefix, creada: k.createdAt.toISOString(), ultimoUso: iso(k.lastUsedAt), revocada: iso(k.revokedAt) })),
    integraciones: conexiones.map((i) => ({
      id: i.id,
      tipo: i.kind,
      nombre: i.name,
      destino: i.target,
      estado: i.status,
      ultimoExito: iso(i.lastSuccessAt),
      ultimaFalla: iso(i.lastFailureAt),
      ultimoError: i.lastError,
    })),
  }
}

/** Ingresos fallidos, IPs y países, MFA, SSO, claves y eventos sensibles. `completo` decide si las IPs van enteras. */
export async function seguridadDelTenant(base: Base, ahora: Date, tenantId: string, completo: boolean) {
  const accesos = and(eq(events.tenantId, tenantId), inArray(events.eventType, ['user.login', 'user.failed_login']), gte(events.createdAt, hace(ahora, 30)))
  const [fallidos] = await base
    .select({
      h24: cuenta(sql`${events.eventType} = 'user.failed_login' and ${events.createdAt} >= ${ts(hace(ahora, 1))}`),
      d7: cuenta(sql`${events.eventType} = 'user.failed_login' and ${events.createdAt} >= ${ts(hace(ahora, 7))}`),
      d30: cuenta(sql`${events.eventType} = 'user.failed_login'`),
    })
    .from(events)
    .where(accesos)
  const pais = sql<string>`coalesce(${events.metadata}->>'pais', 'Desconocido')`
  const ips = await base
    .select({
      ip: events.ipAddress,
      pais,
      ciudad: sql<string | null>`max(${events.metadata}->>'ciudad')`,
      inicios: cuenta(sql`${events.eventType} = 'user.login'`),
      fallidos: cuenta(sql`${events.eventType} = 'user.failed_login'`),
      ultimo: sql<string>`max(${events.createdAt})`.mapWith((v) => new Date(v).toISOString()),
    })
    .from(events)
    .where(and(accesos, isNotNull(events.ipAddress)))
    .groupBy(events.ipAddress, pais)
    .orderBy(sql`max(${events.createdAt}) desc`)
    .limit(40)
  const paises = await base
    .select({ pais, inicios: cuenta(sql`${events.eventType} = 'user.login'`), fallidos: cuenta(sql`${events.eventType} = 'user.failed_login'`) })
    .from(events)
    .where(accesos)
    .groupBy(pais)
    .orderBy(desc(count()))
  const [mfa] = await base
    .select({ total: cuenta(sql`${users.status} <> 'invited'`), conMfa: cuenta(sql`${users.status} <> 'invited' and ${users.mfaEnabled}`) })
    .from(users)
    .where(eq(users.tenantId, tenantId))
  const [fallidosRecientes, cambiosDeRol, sensibles, integraciones] = await Promise.all([
    ultimos(base, tenantId, ['user.failed_login'], 20),
    ultimos(base, tenantId, ['user.role_changed'], 20),
    ultimos(base, tenantId, [...tiposDeCategoria('seguridad'), ...tiposDeCategoria('soporte'), ...tiposDeCategoria('datos')], 30),
    integracionesDelTenant(base, tenantId),
  ])
  const sso = integraciones.integraciones.find((i) => i.tipo === 'sso' && i.estado !== 'disabled')
  return {
    completo,
    fallidos,
    fallidosRecientes: ocultarIps(fallidosRecientes, completo),
    ips: ips.map((i) => ({ ...i, ip: completo ? i.ip : ocultarIp(i.ip) })),
    paises,
    mfa,
    sso: sso ? { activo: true, proveedor: sso.destino } : { activo: false, proveedor: null },
    clavesApi: integraciones.clavesApi,
    cambiosDeRol,
    sensibles: ocultarIps(sensibles, completo),
  }
}
