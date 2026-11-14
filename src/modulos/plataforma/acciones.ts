// Lo que el equipo de la plataforma hace sobre un cliente. Cada acción: pide su permiso, exige un motivo cuando es
// sensible, corre en una transacción y deja su evento con el antes y el después, el motivo, la IP y el navegador.
import { and, eq, isNull } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { conDatos, esHttps, ipDe, rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { type EntornoPlataforma, exigirPermiso } from '../acceso/guardias'
import { origenDe, registrar } from '../eventos/registrar'
import { maquinasIniciales } from '../maquinas/reglas'
import { machines, machineServices } from '../maquinas/tablas'
import { impersonations } from '../soporte/tablas'
import { tallerInicial } from '../taller/comun'
import { diaDe } from './panorama'
import { services, shopSections } from '../taller/tablas'
import { altaTenantSchema, CAMBIOS_DE_ESTADO, ESTADOS_TENANT, type EstadoTenant, FUNCIONES, FUNCIONES_DEL_PLAN, type Funcion, LIMITES, type Limites, PLANES, type Plan } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import { cerrarSesionesDe } from '../acceso/sesion'
import { agregarPersona, exigirOtroAdmin, reenviarInvitacion } from '../usuarios/alta'
import { personaSchema, ROLES_TENANT, type RolTenant } from '../usuarios/reglas'
import { users } from '../usuarios/tablas'

type C = Context<EntornoPlataforma>

/** El próximo cobro: un mes después. Del 31 de enero se pasa al 28 de febrero, no al 3 de marzo. */
export function unMesDespues(ahora: Date) {
  const d = new Date(ahora)
  const dia = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(dia, ultimo))
  return d
}

const motivo = z.string().trim().min(10, 'Escribe el motivo (al menos 10 letras): queda en la auditoría.').max(500)
const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]

/** Una impersonación dura a lo más una hora; para seguir, se abre otra con su motivo. */
export const DURACION_IMPERSONACION_MIN = 60

async function tenantOError(c: C, id: string) {
  const [t] = await c.var.base.select().from(tenants).where(eq(tenants.id, id))
  if (!t) throw rechazo(404, 'No existe ese cliente.')
  return t
}

/** El usuario, buscado dentro del cliente indicado. Aunque el equipo ve todo, una acción no cruza de un cliente a otro. */
async function usuarioDe(c: C, tenantId: string, id: string) {
  const [u] = await c.var.base.select().from(users).where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
  if (!u) throw rechazo(404, 'Ese usuario no es de este cliente.')
  return u
}

/** Con qué evento queda cada cambio de estado. */
const eventoDeEstado = (antes: EstadoTenant, despues: EstadoTenant) =>
  despues === 'suspended' ? 'tenant.suspended' : despues === 'cancelled' ? 'tenant.cancelled' : antes === 'suspended' || antes === 'cancelled' ? 'tenant.reactivated' : 'tenant.updated'

/** Se montan dentro de `rutasPlataforma`, detrás de su guardia (solo el equipo). */
export const accionesPlataforma = new Hono<EntornoPlataforma>()

  /**
   * Dar de alta una rectificadora: el cliente con su plan (en prueba o activo), su taller según la plantilla y su primer
   * administrador, todo junto con sus eventos. Desde aquí su administrador suma a su gente.
   */
  .post('/tenants', conDatos(altaTenantSchema), async (c) => {
    await exigirPermiso(c, 'tenants.create', null)
    const { base, ahora } = c.var
    const d = c.req.valid('json')
    const [ocupado] = await base.select({ nombre: tenants.name }).from(tenants).where(eq(tenants.slug, d.subdominio))
    if (ocupado) throw rechazo(409, `El subdominio «${d.subdominio}» ya es de ${ocupado.nombre}.`)
    const id = nuevoId('tn')
    const prueba = d.estado === 'trial'
    // En prueba no paga todavía; activo, paga el precio de lista salvo que se haya negociado otro.
    const mrr = prueba ? 0 : (d.mrr ?? PLANES[d.plan].precio)
    const proximoCobro = unMesDespues(ahora)
    const pruebaHasta = prueba ? new Date(ahora.getTime() + d.diasPrueba * 86_400_000) : null
    const { secciones, trabajos } = tallerInicial(id, nuevoId, () => 1, d.plantilla)
    const { maquinas, usos } = maquinasIniciales(id, secciones, trabajos, nuevoId, diaDe(ahora))
    const despues = { nombre: d.nombre, subdominio: d.subdominio, region: d.region, plan: d.plan, estado: d.estado, mrr, plantilla: d.plantilla, prueba_hasta: pruebaHasta?.toISOString() ?? null }
    const administrador = await base.transaction(async (tx) => {
      await tx.insert(tenants).values({
        id,
        name: d.nombre,
        slug: d.subdominio,
        region: d.region,
        status: d.estado,
        plan: d.plan,
        featureFlags: Object.fromEntries(FUNCIONES_DEL_PLAN[d.plan].map((f) => [f, true])),
        billingEmail: d.correoFacturacion,
        billingStatus: mrr ? 'paid' : 'none',
        mrr,
        nextBillingAt: mrr ? proximoCobro : null,
        trialEndsAt: pruebaHasta,
        createdAt: ahora,
        updatedAt: ahora,
      })
      await tx.insert(shopSections).values(secciones)
      await tx.insert(services).values(trabajos)
      if (maquinas.length) {
        await tx.insert(machines).values(maquinas)
        await tx.insert(machineServices).values(usos)
      }
      await registrar(tx, origenDe(c), { tenantId: id, eventType: 'tenant.created', targetId: id, targetType: 'tenant', metadata: { antes: null, despues, motivo: d.motivo } })
      return agregarPersona(tx, origenDe(c), id, { ...d.administrador, rol: 'admin' }, ahora, { motivo: d.motivo })
    })
    return c.json({ id, administradorId: administrador.id, invitacion: { enlace: administrador.enlace, vence: administrador.vence }, subdominio: d.subdominio })
  })

  /** Agregar a alguien a un cliente (lo pide el cliente, o su administrador se fue). Respeta el límite de su plan. */
  .post('/tenants/:id/usuarios', conDatos(personaSchema.extend({ motivo })), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    await exigirPermiso(c, 'users.create', t.id)
    if (t.status === 'cancelled') throw rechazo(409, 'El cliente está cancelado.')
    const { motivo, ...persona } = c.req.valid('json')
    return c.json(await c.var.base.transaction((tx) => agregarPersona(tx, origenDe(c), t.id, persona, c.var.ahora, { motivo })))
  })

  /** Un enlace nuevo para una invitación pendiente de un cliente (se le perdió, venció). */
  .post('/tenants/:id/usuarios/:usuario/invitacion', conDatos(z.object({ motivo })), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    await exigirPermiso(c, 'users.create', t.id)
    if (t.status === 'cancelled') throw rechazo(409, 'El cliente está cancelado.')
    const u = await usuarioDe(c, t.id, c.req.param('usuario'))
    const { motivo } = c.req.valid('json')
    return c.json(await c.var.base.transaction((tx) => reenviarInvitacion(tx, origenDe(c), t.id, u, c.var.ahora, { motivo })))
  })

  .post('/tenants/:id/estado', conDatos(z.object({ estado: z.enum(claves(ESTADOS_TENANT)), motivo })), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    await exigirPermiso(c, 'tenants.status', t.id)
    const { estado, motivo } = c.req.valid('json')
    if (estado === t.status) throw rechazo(409, `El cliente ya está ${ESTADOS_TENANT[estado].toLowerCase()}.`)
    if (!CAMBIOS_DE_ESTADO[t.status].includes(estado))
      throw rechazo(409, `No se puede pasar de «${ESTADOS_TENANT[t.status]}» a «${ESTADOS_TENANT[estado]}».`)
    // En prueba no pagaba («el monto mensual queda en cero hasta que se active»): al activarse empieza a pagar su plan,
    // también si entremedio estuvo suspendido o cancelado. Un cliente cancelado deja de cobrarse; si vuelve, vuelve a
    // cobrarse lo que pagaba.
    const precio = PLANES[t.plan].precio
    const empiezaAPagar = estado === 'active' && t.mrr === 0 && (t.status === 'trial' || (t.trialEndsAt !== null && (t.billingStatus === 'none' || t.billingStatus === 'cancelled')))
    const cobro = empiezaAPagar
      ? { mrr: precio, billingStatus: precio ? ('paid' as const) : ('none' as const), nextBillingAt: precio ? unMesDespues(c.var.ahora) : null }
      : estado === 'cancelled'
        ? { billingStatus: 'cancelled' as const, nextBillingAt: null }
        : estado === 'active' && t.status === 'cancelled'
          ? { billingStatus: t.mrr ? ('paid' as const) : ('none' as const), nextBillingAt: t.mrr ? unMesDespues(c.var.ahora) : null }
          : {}
    await c.var.base.transaction(async (tx) => {
      await tx.update(tenants).set({ status: estado, ...cobro, updatedAt: c.var.ahora }).where(eq(tenants.id, t.id))
      await registrar(tx, origenDe(c), {
        tenantId: t.id,
        eventType: eventoDeEstado(t.status, estado),
        targetId: t.id,
        targetType: 'tenant',
        metadata: empiezaAPagar ? { antes: { estado: t.status, mrr: t.mrr }, despues: { estado, mrr: precio }, motivo } : { antes: t.status, despues: estado, motivo },
      })
    })
    return c.json({ ok: true })
  })

  .post('/tenants/:id/plan', conDatos(z.object({ plan: z.enum(claves(PLANES)), mrr: z.number().int().min(0).max(100_000_000).optional(), motivo })), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    await exigirPermiso(c, 'tenants.plan', t.id)
    const { plan, mrr, motivo } = c.req.valid('json')
    if (plan === t.plan && (mrr === undefined || mrr === t.mrr)) throw rechazo(409, 'Ese ya es su plan.')
    // El precio de lista, salvo que se indique otro (Enterprise negociado). Un cliente en prueba no paga todavía.
    const nuevoMrr = t.status === 'trial' ? 0 : (mrr ?? PLANES[plan as Plan].precio)
    // El cobro sigue al monto: de gratis a pagado empieza a cobrarse; de pagado a gratis, deja de cobrarse.
    const cobro =
      t.status === 'trial' || t.status === 'cancelled'
        ? {}
        : nuevoMrr > 0
          ? { billingStatus: t.billingStatus === 'none' ? ('paid' as const) : t.billingStatus, nextBillingAt: t.nextBillingAt ?? unMesDespues(c.var.ahora) }
          : { billingStatus: 'none' as const, nextBillingAt: null }
    await c.var.base.transaction(async (tx) => {
      await tx.update(tenants).set({ plan, mrr: nuevoMrr, ...cobro, updatedAt: c.var.ahora }).where(eq(tenants.id, t.id))
      await registrar(tx, origenDe(c), {
        tenantId: t.id,
        eventType: 'tenant.plan_changed',
        targetId: t.id,
        targetType: 'tenant',
        metadata: { antes: { plan: t.plan, mrr: t.mrr }, despues: { plan, mrr: nuevoMrr }, motivo },
      })
    })
    return c.json({ ok: true })
  })

  .post(
    '/tenants/:id/limites',
    conDatos(
      z.object({
        // Un límite en null vuelve al del plan.
        ajustes: z.object(Object.fromEntries(Object.keys(LIMITES).map((k) => [k, z.number().int().min(0).max(1e10).nullable().optional()])) as Record<keyof Limites, z.ZodOptional<z.ZodNullable<z.ZodNumber>>>),
        motivo,
      }),
    ),
    async (c) => {
      const t = await tenantOError(c, c.req.param('id'))
      await exigirPermiso(c, 'tenants.limits', t.id)
      const { ajustes, motivo } = c.req.valid('json')
      const nuevos: Partial<Limites> = { ...t.limitsOverride }
      for (const [clave, valor] of Object.entries(ajustes) as [keyof Limites, number | null | undefined][]) {
        if (valor === undefined) continue
        if (valor === null || valor === PLANES[t.plan].limites[clave]) delete nuevos[clave]
        else nuevos[clave] = valor
      }
      if (JSON.stringify(nuevos) === JSON.stringify(t.limitsOverride)) throw rechazo(409, 'No cambió ningún límite.')
      await c.var.base.transaction(async (tx) => {
        await tx.update(tenants).set({ limitsOverride: nuevos, updatedAt: c.var.ahora }).where(eq(tenants.id, t.id))
        await registrar(tx, origenDe(c), {
          tenantId: t.id,
          eventType: 'tenant.limits_changed',
          targetId: t.id,
          targetType: 'tenant',
          metadata: { antes: t.limitsOverride, despues: nuevos, motivo },
        })
      })
      return c.json({ ok: true })
    },
  )

  .post('/tenants/:id/funciones', conDatos(z.object({ funcion: z.enum(claves(FUNCIONES)), activa: z.boolean(), motivo })), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    await exigirPermiso(c, 'tenants.flags', t.id)
    const { funcion, activa, motivo } = c.req.valid('json')
    if (Boolean(t.featureFlags[funcion as Funcion]) === activa) throw rechazo(409, 'La función ya estaba así.')
    await c.var.base.transaction(async (tx) => {
      await tx.update(tenants).set({ featureFlags: { ...t.featureFlags, [funcion]: activa }, updatedAt: c.var.ahora }).where(eq(tenants.id, t.id))
      await registrar(tx, origenDe(c), {
        tenantId: t.id,
        eventType: 'tenant.feature_flag_changed',
        targetId: t.id,
        targetType: 'tenant',
        metadata: { funcion, antes: Boolean(t.featureFlags[funcion as Funcion]), despues: activa, motivo },
      })
    })
    return c.json({ ok: true })
  })

  .post('/tenants/:id/usuarios/:usuario/bloqueo', conDatos(z.object({ bloqueado: z.boolean(), motivo })), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    await exigirPermiso(c, 'users.block', t.id)
    const u = await usuarioDe(c, t.id, c.req.param('usuario'))
    const { bloqueado, motivo } = c.req.valid('json')
    if (u.status === 'invited') throw rechazo(409, 'Una invitación pendiente no se bloquea: se anula desde el panel del cliente.')
    if ((u.status === 'blocked') === bloqueado) throw rechazo(409, bloqueado ? 'Ya estaba bloqueado.' : 'No estaba bloqueado.')
    await c.var.base.transaction(async (tx) => {
      // La consola tampoco deja a un cliente sin administrador activo (después nadie podría entrar como él).
      if (bloqueado && u.role === 'admin' && u.status === 'active') await exigirOtroAdmin(tx, t.id, u.id)
      await tx.update(users).set({ status: bloqueado ? 'blocked' : 'active', blockedAt: bloqueado ? c.var.ahora : null }).where(eq(users.id, u.id))
      if (bloqueado) await cerrarSesionesDe(tx, u.id, c.var.ahora)
      await registrar(tx, origenDe(c), { tenantId: t.id, eventType: bloqueado ? 'user.blocked' : 'user.unblocked', userId: u.id, targetId: u.id, targetType: 'user', metadata: { antes: u.status, despues: bloqueado ? 'blocked' : 'active', motivo } })
    })
    return c.json({ ok: true })
  })

  .post('/tenants/:id/usuarios/:usuario/rol', conDatos(z.object({ rol: z.enum(claves(ROLES_TENANT)), motivo })), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    await exigirPermiso(c, 'users.roles', t.id)
    const u = await usuarioDe(c, t.id, c.req.param('usuario'))
    const { rol, motivo } = c.req.valid('json')
    if (u.role === rol) throw rechazo(409, `Ya es ${ROLES_TENANT[rol as RolTenant].toLowerCase()}.`)
    await c.var.base.transaction(async (tx) => {
      if (u.role === 'admin' && u.status === 'active') await exigirOtroAdmin(tx, t.id, u.id)
      await tx.update(users).set({ role: rol }).where(eq(users.id, u.id))
      await registrar(tx, origenDe(c), { tenantId: t.id, eventType: 'user.role_changed', userId: u.id, targetId: u.id, targetType: 'user', metadata: { antes: u.role, despues: rol, motivo } })
    })
    return c.json({ ok: true })
  })

  /**
   * Entrar como el administrador de un cliente. Pide el permiso, que el cliente lo permita, un administrador activo
   * y un motivo. Queda la fila en `impersonations` (con la IP de quien entra) y el evento de inicio.
   */
  .post('/tenants/:id/impersonar', conDatos(z.object({ usuario: z.string(), motivo })), async (c) => {
    const t = await tenantOError(c, c.req.param('id'))
    await exigirPermiso(c, 'support.impersonate', t.id)
    if (!t.supportAccess) throw rechazo(403, 'Este cliente no permite el acceso de soporte a su cuenta.')
    if (t.status === 'cancelled') throw rechazo(409, 'El cliente está cancelado.')
    const { usuario, motivo } = c.req.valid('json')
    const u = await usuarioDe(c, t.id, usuario)
    if (u.role !== 'admin' || u.status !== 'active') throw rechazo(409, 'Solo se puede entrar como un administrador activo del cliente.')
    const { base, ahora, actor } = c.var
    const id = nuevoId('imp')
    const vence = new Date(ahora.getTime() + DURACION_IMPERSONACION_MIN * 60_000)
    await base.transaction(async (tx) => {
      // Una impersonación abierta a la vez por persona del equipo: abrir otra cierra la anterior.
      // Si ya había vencido, terminó cuando venció (como al terminarla a mano), no ahora.
      const abiertas = await tx.select().from(impersonations).where(and(eq(impersonations.adminId, actor.id), isNull(impersonations.endedAt)))
      for (const a of abiertas) {
        const vencida = a.expiresAt < ahora
        const fin = vencida ? a.expiresAt : ahora
        // Solo si sigue abierta: si otro pedido la cerró recién, no queda un segundo término.
        const [cerrada] = await tx.update(impersonations).set({ endedAt: fin }).where(and(eq(impersonations.id, a.id), isNull(impersonations.endedAt))).returning({ id: impersonations.id })
        if (!cerrada) continue
        await registrar(tx, origenDe(c), { tenantId: a.tenantId, eventType: 'support.impersonation_ended', userId: a.userId, targetId: a.id, targetType: 'impersonation', metadata: { motivo_cierre: vencida ? 'vencida' : 'reemplazada', duracion_min: Math.round((fin.getTime() - a.startedAt.getTime()) / 60_000) } })
      }
      await tx.insert(impersonations).values({ id, adminId: actor.id, tenantId: t.id, userId: u.id, reason: motivo, adminIp: ipDe(c), userAgent: c.req.header('user-agent') ?? null, startedAt: ahora, expiresAt: vence })
      await registrar(tx, origenDe(c), {
        tenantId: t.id,
        eventType: 'support.impersonation_started',
        userId: u.id,
        targetId: id,
        targetType: 'impersonation',
        metadata: { motivo, vence: vence.toISOString(), admin_nombre: actor.nombre },
      })
    })
    setCookie(c, 'impersonacion', id, { path: '/', httpOnly: true, sameSite: 'Strict', secure: esHttps(c), maxAge: DURACION_IMPERSONACION_MIN * 60 })
    return c.json({ ok: true, id, vence: vence.toISOString() })
  })

  /** Terminar la impersonación abierta (la de la cookie). Queda la hora de fin y su evento. */
  .post('/impersonacion/terminar', async (c) => {
    const { base, ahora, actor } = c.var
    const id = getCookie(c, 'impersonacion')
    deleteCookie(c, 'impersonacion', { path: '/' })
    if (!id) return c.json({ ok: true, tenantId: null })
    const [imp] = await base.select().from(impersonations).where(and(eq(impersonations.id, id), eq(impersonations.adminId, actor.id)))
    if (!imp) return c.json({ ok: true, tenantId: null })
    if (!imp.endedAt)
      await base.transaction(async (tx) => {
        // Si ya había vencido, el fin es la hora en que venció.
        const fin = imp.expiresAt < ahora ? imp.expiresAt : ahora
        await tx.update(impersonations).set({ endedAt: fin }).where(eq(impersonations.id, imp.id))
        await registrar(tx, origenDe(c), {
          tenantId: imp.tenantId,
          eventType: 'support.impersonation_ended',
          userId: imp.userId,
          targetId: imp.id,
          targetType: 'impersonation',
          metadata: { duracion_min: Math.round((fin.getTime() - imp.startedAt.getTime()) / 60_000) },
        })
      })
    return c.json({ ok: true, tenantId: imp.tenantId })
  })
