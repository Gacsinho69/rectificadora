// La consola del equipo de la plataforma: lectura global. Las acciones están en `acciones.ts`.
import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { conFiltros, rechazo } from '../../http'
import { type EntornoPlataforma, exigirPermiso, soloEquipo } from '../acceso/guardias'
import { ORDEN_PRIORIDAD, type Prioridad, PRIORIDADES, TIPOS_ALERTA } from '../alertas/reglas'
import { buscarEventos, conNombres, filtrosEventos } from '../eventos/consulta'
import { origenDe, registrar } from '../eventos/registrar'
import { events } from '../eventos/tablas'
import { impersonations } from '../soporte/tablas'
import { ESTADOS_TENANT, type EstadoTenant, FUNCIONES, type Funcion, limitesDe, PLANES } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import { platformAdmins, users } from '../usuarios/tablas'
import {
  actividadDelTenant,
  actividadPorDia,
  facturasDelTenant,
  integracionesDelTenant,
  ocultarIp,
  ocultarIps,
  seguridadDelTenant,
  usoDelTenant,
  usuariosDelTenant,
} from './consultas'
import { accionesPlataforma } from './acciones'
import { filtrarTenants, filtrosTenants, normalizar } from './listado'
import { cuenta, hace, panorama, todasLasAlertas, ts } from './panorama'

/** El dominio de la plataforma: cada cliente vive en `<subdominio>.<dominio>`. */
export const DOMINIO = process.env.DOMINIO_PLATAFORMA ?? 'rectificadora.test'

type C = Context<EntornoPlataforma>

async function tenantOError(c: C, id: string) {
  const [t] = await c.var.base.select().from(tenants).where(eq(tenants.id, id))
  if (!t) throw rechazo(404, 'No existe ese cliente.')
  return t
}

/**
 * IPs completas y ubicaciones exactas: solo si se piden (`?completo=1`), con el permiso, y queda anotado. Una vista
 * repetida dentro de 15 minutos no se vuelve a anotar, para que la auditoría no se llene de lo mismo.
 */
async function verSensible(c: C, tenantId: string | null, recurso: string) {
  if (c.req.query('completo') !== '1') return false
  await exigirPermiso(c, 'data.sensitive', tenantId)
  const [reciente] = await c.var.base
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.eventType, 'data.sensitive_accessed'),
        eq(events.actorId, c.var.actor.id),
        tenantId ? eq(events.tenantId, tenantId) : isNull(events.tenantId),
        gte(events.createdAt, new Date(c.var.ahora.getTime() - 15 * 60_000)),
        sql`${events.metadata}->>'recurso' = ${recurso}`,
      ),
    )
    .limit(1)
  if (!reciente) await registrar(c.var.base, origenDe(c), { tenantId, eventType: 'data.sensitive_accessed', metadata: { recurso } })
  return true
}

export const rutasPlataforma = new Hono<EntornoPlataforma>()
  .use(soloEquipo)

  .get('/resumen', async (c) => {
    const { base, ahora } = c.var
    const lista = await panorama(base, ahora)
    const alertas = await todasLasAlertas(base, ahora, lista)
    const porEstado = Object.fromEntries(Object.keys(ESTADOS_TENANT).map((e) => [e, lista.filter((t) => t.estado === e).length])) as Record<EstadoTenant, number>
    const suma = (f: (t: (typeof lista)[number]) => number) => lista.reduce((s, t) => s + f(t), 0)
    const pagando = lista.filter((t) => t.estado === 'active' || t.estado === 'past_due')
    const [logins] = await base
      .select({
        d1: cuenta(sql`${events.eventType} = 'user.login' and ${events.createdAt} >= ${ts(hace(ahora, 1))}`),
        d7: cuenta(sql`${events.eventType} = 'user.login' and ${events.createdAt} >= ${ts(hace(ahora, 7))}`),
        d30: cuenta(sql`${events.eventType} = 'user.login'`),
        fallidos24h: cuenta(sql`${events.eventType} = 'user.failed_login' and ${events.createdAt} >= ${ts(hace(ahora, 1))}`),
        fallidos7d: cuenta(sql`${events.eventType} = 'user.failed_login' and ${events.createdAt} >= ${ts(hace(ahora, 7))}`),
        errores24h: cuenta(sql`${events.severity} in ('error', 'critical') and ${events.createdAt} >= ${ts(hace(ahora, 1))}`),
        criticos24h: cuenta(sql`${events.eventType} = 'system.error' and ${events.severity} = 'critical' and ${events.createdAt} >= ${ts(hace(ahora, 1))}`),
      })
      .from(events)
      .where(gte(events.createdAt, hace(ahora, 30)))
    const errores = await conNombres(
      base,
      await base
        .select()
        .from(events)
        .where(and(inArray(events.eventType, ['system.error', 'system.job_failed', 'system.webhook_failed']), gte(events.createdAt, hace(ahora, 7))))
        .orderBy(sql`case ${events.severity} when 'critical' then 0 else 1 end`, desc(events.createdAt))
        .limit(8),
    )
    const porPrioridad = Object.fromEntries(Object.keys(PRIORIDADES).map((p) => [p, alertas.filter((a) => a.prioridad === p).length])) as Record<Prioridad, number>
    const atencion = lista
      .filter((t) => t.salud && (t.salud.estado === 'critical' || t.salud.estado === 'at_risk'))
      .sort((a, b) => a.salud!.puntaje - b.salud!.puntaje)
      .slice(0, 10)
      .map((t) => ({ id: t.id, nombre: t.nombre, plan: t.plan, estado: t.estado, mrr: t.mrr, salud: t.salud!, ultimoLogin: t.ultimoLogin, alertas: t.alertas.length, motivo: t.alertas[0]?.titulo ?? null }))
    return c.json({
      tenants: { total: lista.length, porEstado },
      usuarios: { total: suma((t) => t.usuarios.total), activos24h: suma((t) => t.usuarios.activos24h), activos7d: suma((t) => t.usuarios.activos7d), activos30d: suma((t) => t.usuarios.activos30d) },
      logins,
      mrr: {
        total: pagando.reduce((s, t) => s + t.mrr, 0),
        // Lo que se puede perder de lo que hoy paga: un cliente suspendido o cancelado ya no suma al MRR.
        enRiesgo: pagando.filter((t) => t.estadoPago === 'past_due' || t.estadoPago === 'failed').reduce((s, t) => s + t.mrr, 0),
        clientesPagando: pagando.filter((t) => t.mrr > 0).length,
      },
      pagos: { vencidos: lista.filter((t) => t.estadoPago === 'past_due').length, fallidos: lista.filter((t) => t.estadoPago === 'failed').length },
      // Sin pedir lo completo (con permiso y anotado), la IP de quien provocó el error va tapada.
      errores: { recientes: ocultarIps(errores, false) },
      alertas: { total: alertas.length, porPrioridad, principales: alertas.slice(0, 8) },
      atencion,
      porDia: await actividadPorDia(base, ahora, 30),
    })
  })

  .get('/tenants', conFiltros(filtrosTenants), async (c) => {
    const { base, ahora } = c.var
    const f = c.req.valid('query')
    const lista = await panorama(base, ahora)
    let correos = new Map<string, string[]>()
    if (f.q) {
      const encontrados = await base.select({ tenantId: users.tenantId, email: users.email }).from(users).where(ilike(users.email, `%${f.q.replace(/[%_\\]/g, '\\$&')}%`))
      for (const u of encontrados) correos.set(u.tenantId, [...(correos.get(u.tenantId) ?? []), u.email])
    }
    const { total, filas } = filtrarTenants(lista, f, correos)
    return c.json({ total, pagina: f.pagina, porPagina: f.porPagina, filas })
  })

  .get('/tenants/:id', async (c) => {
    const { base, ahora } = c.var
    const t = await tenantOError(c, c.req.param('id'))
    const [resumen] = await panorama(base, ahora, t.id)
    const administradores = await base
      .select({ id: users.id, nombre: users.name, correo: users.email, estado: users.status, ultimoLogin: users.lastLoginAt })
      .from(users)
      .where(and(eq(users.tenantId, t.id), eq(users.role, 'admin')))
      .orderBy(asc(users.name))
    const impersonaciones = await base
      .select({ id: impersonations.id, admin: platformAdmins.name, usuario: users.name, motivo: impersonations.reason, inicio: impersonations.startedAt, fin: impersonations.endedAt, vence: impersonations.expiresAt })
      .from(impersonations)
      .innerJoin(platformAdmins, eq(platformAdmins.id, impersonations.adminId))
      .innerJoin(users, eq(users.id, impersonations.userId))
      .where(eq(impersonations.tenantId, t.id))
      .orderBy(desc(impersonations.startedAt))
      .limit(5)
    const funciones = Object.fromEntries((Object.keys(FUNCIONES) as Funcion[]).map((f) => [f, Boolean(t.featureFlags[f])])) as Record<Funcion, boolean>
    return c.json({
      ...resumen,
      dominio: `${t.slug}.${DOMINIO}`,
      dominioPropio: t.customDomain,
      limites: limitesDe(t.plan, t.limitsOverride),
      limitesDelPlan: PLANES[t.plan].limites,
      ajustes: t.limitsOverride,
      funciones,
      accesoSoporte: t.supportAccess,
      mfaObligatorio: t.mfaRequired,
      administradores: administradores.map((a) => ({ ...a, ultimoLogin: a.ultimoLogin?.toISOString() ?? null })),
      impersonaciones,
    })
  })

  .get('/tenants/:id/usuarios', async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    const completo = await verSensible(c, t.id, 'usuarios')
    const lista = await usuariosDelTenant(c.var.base, t.id)
    return c.json({ completo, usuarios: lista.map((u) => ({ ...u, ultimaIp: completo ? u.ultimaIp : ocultarIp(u.ultimaIp) })) })
  })

  .get('/tenants/:id/actividad', async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    const completo = await verSensible(c, t.id, 'actividad')
    const a = await actividadDelTenant(c.var.base, c.var.ahora, t.id)
    return c.json({ ...a, completo, logins: ocultarIps(a.logins, completo), fallidos: ocultarIps(a.fallidos, completo), acciones: ocultarIps(a.acciones, completo), operaciones: ocultarIps(a.operaciones, completo) })
  })

  .get('/tenants/:id/uso', async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    const [resumen] = await panorama(c.var.base, c.var.ahora, t.id)
    return c.json({ usos: resumen.usos, ...(await usoDelTenant(c.var.base, c.var.ahora, t.id)) })
  })

  .get('/tenants/:id/facturacion', async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    const pagos = await conNombres(
      c.var.base,
      await c.var.base
        .select()
        .from(events)
        .where(and(eq(events.tenantId, t.id), sql`(${events.eventType} like 'billing.%' or ${events.eventType} = 'tenant.plan_changed')`))
        .orderBy(desc(events.createdAt))
        .limit(20),
    )
    return c.json({
      plan: t.plan,
      precioPlan: PLANES[t.plan].precio,
      mrr: t.mrr,
      estadoPago: t.billingStatus,
      proximoCobro: t.nextBillingAt?.toISOString() ?? null,
      correo: t.billingEmail,
      facturas: await facturasDelTenant(c.var.base, t.id),
      eventos: pagos,
    })
  })

  .get('/tenants/:id/integraciones', async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    return c.json(await integracionesDelTenant(c.var.base, t.id))
  })

  .get('/tenants/:id/seguridad', async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    const completo = await verSensible(c, t.id, 'seguridad')
    return c.json({ ...(await seguridadDelTenant(c.var.base, c.var.ahora, t.id, completo)), mfaObligatorio: t.mfaRequired })
  })

  .get('/tenants/:id/eventos', conFiltros(filtrosEventos), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    const completo = await verSensible(c, t.id, 'auditoria')
    const r = await buscarEventos(c.var.base, c.req.valid('query'), { tenantId: t.id })
    return c.json({ ...r, completo, filas: ocultarIps(r.filas, completo) })
  })

  .get('/alertas', async (c) => {
    const lista = await panorama(c.var.base, c.var.ahora)
    const alertas = await todasLasAlertas(c.var.base, c.var.ahora, lista)
    return c.json({ alertas, tipos: TIPOS_ALERTA, orden: ORDEN_PRIORIDAD })
  })

  .get('/actividad', conFiltros(z.object({ dias: z.coerce.number().int().min(1).max(365).default(14) })), async (c) => {
    const { base, ahora } = c.var
    const { dias } = c.req.valid('query')
    const completo = await verSensible(c, null, 'actividad_global')
    const lista = await panorama(base, ahora)
    const tenantsInactivos = lista
      .filter((t) => t.estado !== 'cancelled' && t.estado !== 'suspended' && (t.diasSinLogin === null || t.diasSinLogin >= dias))
      .sort((a, b) => (b.diasSinLogin ?? Infinity) - (a.diasSinLogin ?? Infinity))
      .map((t) => ({ id: t.id, nombre: t.nombre, estado: t.estado, plan: t.plan, mrr: t.mrr, usuarios: t.usuarios.total, ultimoLogin: t.ultimoLogin, diasSinLogin: t.diasSinLogin }))
    // Solo de clientes en uso: en uno suspendido o cancelado, que nadie entre es lo esperado.
    const inactivos = and(eq(users.status, 'active'), sql`(${users.lastLoginAt} is null or ${users.lastLoginAt} < ${ts(hace(ahora, 30))})`, inArray(tenants.status, ['active', 'trial', 'past_due']))
    const [{ total: totalInactivos }] = await base.select({ total: cuenta(sql`true`) }).from(users).innerJoin(tenants, eq(tenants.id, users.tenantId)).where(inactivos)
    const usuariosInactivos = await base
      .select({ id: users.id, nombre: users.name, correo: users.email, rol: users.role, tenantId: users.tenantId, tenantNombre: tenants.name, ultimoLogin: users.lastLoginAt, creado: users.createdAt })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(inactivos)
      .orderBy(sql`${users.lastLoginAt} asc nulls first`)
      .limit(100)
    // Ráfagas de ingresos fallidos en 24 h: por persona (5 o más) y por IP (10 o más).
    const fallidos24 = and(eq(events.eventType, 'user.failed_login'), gte(events.createdAt, hace(ahora, 1)))
    const porPersona = await base
      .select({
        clave: sql<string>`coalesce(${users.email}, ${events.metadata}->>'correo', '(desconocido)')`,
        tenantId: events.tenantId,
        tenantNombre: tenants.name,
        fallidos: cuenta(sql`true`),
        ips: sql<number>`count(distinct ${events.ipAddress})`.mapWith(Number),
        ultimo: sql<string>`max(${events.createdAt})`.mapWith((v) => new Date(v).toISOString()),
      })
      .from(events)
      .leftJoin(users, eq(users.id, events.userId))
      .leftJoin(tenants, eq(tenants.id, events.tenantId))
      .where(fallidos24)
      .groupBy(sql`coalesce(${users.email}, ${events.metadata}->>'correo', '(desconocido)')`, events.tenantId, tenants.name)
      .having(sql`count(*) >= 5`)
    const porIp = await base
      .select({
        clave: events.ipAddress,
        tenantId: sql<string | null>`case when count(distinct ${events.tenantId}) = 1 then max(${events.tenantId}) end`,
        tenantNombre: sql<string | null>`case when count(distinct ${events.tenantId}) = 1 then max(${tenants.name}) else count(distinct ${events.tenantId})::text || ' clientes' end`,
        fallidos: cuenta(sql`true`),
        cuentas: sql<number>`count(distinct coalesce(${events.userId}, ${events.metadata}->>'correo'))`.mapWith(Number),
        ultimo: sql<string>`max(${events.createdAt})`.mapWith((v) => new Date(v).toISOString()),
      })
      .from(events)
      .leftJoin(tenants, eq(tenants.id, events.tenantId))
      .where(fallidos24)
      .groupBy(events.ipAddress)
      .having(sql`count(*) >= 10`)
    const anomalias = [
      ...porPersona.map((p) => ({ tipo: 'cuenta' as const, ...p, detalle: `${p.fallidos} intentos desde ${p.ips} IP${p.ips === 1 ? '' : 's'}` })),
      ...porIp.map((p) => ({ tipo: 'ip' as const, ...p, clave: completo ? p.clave : ocultarIp(p.clave), detalle: `${p.fallidos} intentos contra ${p.cuentas} cuenta${p.cuentas === 1 ? '' : 's'}` })),
    ].sort((a, b) => b.fallidos - a.fallidos)
    const fallidosRecientes = await conNombres(base, await base.select().from(events).where(eq(events.eventType, 'user.failed_login')).orderBy(desc(events.createdAt)).limit(40))
    const [logins] = await base
      .select({
        d1: cuenta(sql`${events.eventType} = 'user.login' and ${events.createdAt} >= ${ts(hace(ahora, 1))}`),
        d7: cuenta(sql`${events.eventType} = 'user.login' and ${events.createdAt} >= ${ts(hace(ahora, 7))}`),
        d30: cuenta(sql`${events.eventType} = 'user.login'`),
        fallidos24h: cuenta(sql`${events.eventType} = 'user.failed_login' and ${events.createdAt} >= ${ts(hace(ahora, 1))}`),
        fallidos7d: cuenta(sql`${events.eventType} = 'user.failed_login' and ${events.createdAt} >= ${ts(hace(ahora, 7))}`),
        fallidos30d: cuenta(sql`${events.eventType} = 'user.failed_login'`),
      })
      .from(events)
      .where(gte(events.createdAt, hace(ahora, 30)))
    return c.json({
      completo,
      dias,
      logins,
      porDia: await actividadPorDia(base, ahora, 30),
      tenantsInactivos,
      usuariosInactivos: { total: totalInactivos, lista: usuariosInactivos.map((u) => ({ ...u, ultimoLogin: u.ultimoLogin?.toISOString() ?? null, creado: u.creado.toISOString() })) },
      anomalias,
      fallidosRecientes: ocultarIps(fallidosRecientes, completo),
    })
  })

  /** El último ingreso de cada persona, buscando por nombre o correo en todos los clientes. */
  .get('/usuarios', conFiltros(z.object({ q: z.string().trim().min(2, 'Escribe al menos dos letras.').max(120) })), async (c) => {
    const { q } = c.req.valid('query')
    const patron = `%${normalizar(q).replace(/[%_\\]/g, '\\$&')}%`
    // Sin tildes también en la base: «gonzalez» encuentra «González».
    const sinTildes = sql`translate(lower(${users.name}), 'áéíóúüñ', 'aeiouun')`
    const lista = await c.var.base
      .select({ id: users.id, nombre: users.name, correo: users.email, rol: users.role, estado: users.status, mfa: users.mfaEnabled, tenantId: users.tenantId, tenantNombre: tenants.name, ultimoLogin: users.lastLoginAt, creado: users.createdAt })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(or(sql`${sinTildes} like ${patron}`, ilike(users.email, patron), eq(users.id, q)))
      .orderBy(sql`${users.lastLoginAt} desc nulls last`)
      .limit(50)
    return c.json(lista.map((u) => ({ ...u, ultimoLogin: u.ultimoLogin?.toISOString() ?? null, creado: u.creado.toISOString() })))
  })

  .get('/eventos', conFiltros(filtrosEventos), async (c) => {
    const completo = await verSensible(c, null, 'auditoria_global')
    const r = await buscarEventos(c.var.base, c.req.valid('query'), 'global')
    return c.json({ ...r, completo, filas: ocultarIps(r.filas, completo) })
  })

  /** Para las pantallas: los clientes por nombre (filtros) y el dominio de la plataforma (el alta muestra el subdominio). */
  .get('/opciones', async (c) => {
    const lista = await c.var.base.select({ id: tenants.id, nombre: tenants.name }).from(tenants).orderBy(asc(tenants.name))
    return c.json({ tenants: lista, dominio: DOMINIO })
  })

  .route('/', accionesPlataforma)
