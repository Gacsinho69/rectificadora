// El panel del administrador de cada cliente: solo su organización. El tenant sale del actor (su sesión, o la
// impersonación de soporte) y de ningún dato del pedido; cada consulta de aquí lo lleva.
// Nada de lo interno de la plataforma (salud, alertas, MRR de otros, notas del equipo) sale por estas rutas.
import { and, count, eq, ne } from 'drizzle-orm'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { conDatos, conFiltros, rechazo } from '../../http'
import { type EntornoTenant, exigirTenantOperativo, soloAdminDelTenant, usuarioDelTenant } from '../acceso/guardias'
import { buscarEventos, filtrosEventos } from '../eventos/consulta'
import { origenDe, registrar } from '../eventos/registrar'
import {
  actividadPorDia,
  facturasDelTenant,
  integracionesDelTenant,
  seguridadDelTenant,
  usoDelTenant,
  usuariosDelTenant,
} from '../plataforma/consultas'
import { panorama } from '../plataforma/panorama'
import { DOMINIO } from '../plataforma/rutas'
import { FUNCIONES, type Funcion, PLANES } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import { agregarPersona, cupoDeUsuarios } from '../usuarios/alta'
import { personaSchema, ROLES_TENANT, type RolTenant } from '../usuarios/reglas'
import { users } from '../usuarios/tablas'

type C = Context<EntornoTenant>
const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]

/** Que siempre quede al menos un administrador activo: si no, la organización queda sin quien la administre. */
async function quedaOtroAdmin(c: C, sinEste: string) {
  const [{ otros }] = await c.var.base
    .select({ otros: count() })
    .from(users)
    .where(and(eq(users.tenantId, c.var.actor.tenantId), eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, sinEste)))
  if (otros === 0) throw rechazo(409, 'Debe quedar al menos un administrador activo en la organización.')
}

export const rutasOrganizacion = new Hono<EntornoTenant>()
  .use(soloAdminDelTenant as unknown as MiddlewareHandler<EntornoTenant>)

  .get('/resumen', async (c) => {
    const { base, ahora, actor } = c.var
    const tenantId = actor.tenantId
    const [[r], [t], lista, facturas, integraciones, porDia] = await Promise.all([
      panorama(base, ahora, tenantId),
      base.select().from(tenants).where(eq(tenants.id, tenantId)),
      usuariosDelTenant(base, tenantId),
      facturasDelTenant(base, tenantId),
      integracionesDelTenant(base, tenantId),
      actividadPorDia(base, ahora, 30, tenantId),
    ])
    const activos = lista.filter((u) => u.estado !== 'invited')
    return c.json({
      organizacion: {
        id: t.id,
        nombre: t.name,
        plan: t.plan,
        nombrePlan: PLANES[t.plan].nombre,
        estado: t.status,
        dominio: `${t.slug}.${DOMINIO}`,
        dominioPropio: t.customDomain,
        trialVence: t.trialEndsAt?.toISOString() ?? null,
        funciones: (Object.keys(FUNCIONES) as Funcion[]).filter((f) => t.featureFlags[f]),
        mfaObligatorio: t.mfaRequired,
        accesoSoporte: t.supportAccess,
      },
      usos: r.usos,
      usuarios: { ...r.usuarios, administradores: activos.filter((u) => u.rol === 'admin').length, conMfa: activos.filter((u) => u.mfa).length },
      ultimosLogins: lista
        .filter((u) => u.ultimoLogin)
        .sort((a, b) => b.ultimoLogin!.localeCompare(a.ultimoLogin!))
        .slice(0, 8),
      invitaciones: lista.filter((u) => u.estado === 'invited'),
      facturacion: { estado: t.billingStatus, montoMensual: t.mrr, proximoCobro: t.nextBillingAt?.toISOString() ?? null, ultimaFactura: facturas[0] ?? null },
      integraciones: {
        activas: integraciones.integraciones.filter((i) => i.estado === 'active').length,
        fallando: integraciones.integraciones.filter((i) => i.estado === 'failing').length,
        clavesApi: integraciones.clavesApi.filter((k) => !k.revocada).length,
      },
      fallidos24h: r.fallidos24h,
      porDia,
    })
  })

  .get('/usuarios', async (c) => c.json(await usuariosDelTenant(c.var.base, c.var.actor.tenantId)))

  /** Cuántos usuarios ocupan el plan y cuántos permite: lo que el administrador ve antes de agregar a alguien. */
  .get('/usuarios/cupo', async (c) => c.json(await cupoDeUsuarios(c.var.base, c.var.actor.tenantId)))

  /** Agregar a alguien de la organización (un técnico nuevo, el chofer), mientras alcance el plan. */
  .post('/usuarios', conDatos(personaSchema), async (c) => {
    exigirTenantOperativo(c)
    const d = c.req.valid('json')
    const id = await c.var.base.transaction((tx) => agregarPersona(tx, origenDe(c), c.var.actor.tenantId, d, c.var.ahora))
    return c.json({ id })
  })

  .post('/usuarios/:id/bloqueo', conDatos(z.object({ bloqueado: z.boolean(), motivo: z.string().trim().max(500).optional() })), async (c) => {
    exigirTenantOperativo(c)
    const u = await usuarioDelTenant(c, c.req.param('id'))
    const { bloqueado, motivo } = c.req.valid('json')
    if (u.id === c.var.actor.id) throw rechazo(409, 'No puedes bloquearte a ti mismo.')
    if (u.status === 'invited') throw rechazo(409, 'Una invitación pendiente no se bloquea.')
    if ((u.status === 'blocked') === bloqueado) throw rechazo(409, bloqueado ? 'Ya estaba bloqueado.' : 'No estaba bloqueado.')
    if (bloqueado && u.role === 'admin') await quedaOtroAdmin(c, u.id)
    await c.var.base.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: bloqueado ? 'blocked' : 'active', blockedAt: bloqueado ? c.var.ahora : null })
        .where(and(eq(users.id, u.id), eq(users.tenantId, c.var.actor.tenantId)))
      await registrar(tx, origenDe(c), {
        tenantId: c.var.actor.tenantId,
        eventType: bloqueado ? 'user.blocked' : 'user.unblocked',
        userId: u.id,
        targetId: u.id,
        targetType: 'user',
        metadata: { motivo: motivo || null },
      })
    })
    return c.json({ ok: true })
  })

  .post('/usuarios/:id/rol', conDatos(z.object({ rol: z.enum(claves(ROLES_TENANT)) })), async (c) => {
    exigirTenantOperativo(c)
    const u = await usuarioDelTenant(c, c.req.param('id'))
    const { rol } = c.req.valid('json')
    if (u.role === rol) throw rechazo(409, `Ya es ${ROLES_TENANT[rol as RolTenant].toLowerCase()}.`)
    if (u.role === 'admin') await quedaOtroAdmin(c, u.id)
    await c.var.base.transaction(async (tx) => {
      await tx.update(users).set({ role: rol }).where(and(eq(users.id, u.id), eq(users.tenantId, c.var.actor.tenantId)))
      await registrar(tx, origenDe(c), {
        tenantId: c.var.actor.tenantId,
        eventType: 'user.role_changed',
        userId: u.id,
        targetId: u.id,
        targetType: 'user',
        metadata: { antes: u.role, despues: rol },
      })
    })
    return c.json({ ok: true })
  })

  .get('/uso', async (c) => {
    const [r] = await panorama(c.var.base, c.var.ahora, c.var.actor.tenantId)
    return c.json({ usos: r.usos, ...(await usoDelTenant(c.var.base, c.var.ahora, c.var.actor.tenantId)) })
  })

  .get('/facturacion', async (c) => {
    const [t] = await c.var.base.select().from(tenants).where(eq(tenants.id, c.var.actor.tenantId))
    return c.json({
      plan: t.plan,
      montoMensual: t.mrr,
      estadoPago: t.billingStatus,
      proximoCobro: t.nextBillingAt?.toISOString() ?? null,
      correo: t.billingEmail,
      facturas: await facturasDelTenant(c.var.base, t.id),
    })
  })

  .get('/integraciones', async (c) => c.json(await integracionesDelTenant(c.var.base, c.var.actor.tenantId)))

  // Son las IPs de su propia gente: el administrador del cliente las ve completas.
  .get('/seguridad', async (c) => {
    const [t] = await c.var.base.select({ mfaRequired: tenants.mfaRequired, supportAccess: tenants.supportAccess }).from(tenants).where(eq(tenants.id, c.var.actor.tenantId))
    return c.json({ ...(await seguridadDelTenant(c.var.base, c.var.ahora, c.var.actor.tenantId, true)), mfaObligatorio: t.mfaRequired, accesoSoporte: t.supportAccess })
  })

  .get('/eventos', conFiltros(filtrosEventos), async (c) => {
    const f = c.req.valid('query')
    return c.json(await buscarEventos(c.var.base, { ...f, tenant: undefined }, { tenantId: c.var.actor.tenantId }))
  })
