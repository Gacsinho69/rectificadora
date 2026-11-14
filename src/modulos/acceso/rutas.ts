// Entrar, aceptar una invitación y cambiar la clave. Son las únicas rutas que no piden estar dentro.
//
// Al entrar: el correo puede tener cuenta en varias rectificadoras (y ser del equipo de la plataforma). Se prueba la
// clave contra cada una; si calza en una, se entra; si calza en varias, se elige a cuál. Un error no dice si el correo
// existe. Cinco intentos fallidos con un correo en 15 minutos lo frenan, y cada uno queda en la auditoría.
//
// `portal` dice adónde se quiere entrar: el subdominio de una rectificadora, o «plataforma» para la consola (es un
// subdominio reservado: ninguna rectificadora lo puede tener).
import { and, count, eq, gt, gte, isNull, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { conDatos, type Entorno, ipDe, rechazo } from '../../http'
import { origenDe, registrar } from '../eventos/registrar'
import { events } from '../eventos/tablas'
import { tenants } from '../tenants/tablas'
import { platformAdmins, users } from '../usuarios/tablas'
import { cifrarClave, claveCorrecta, faltaDeLaClave, huellaDe } from './claves'
import { abrirSesion, cerrarSesionesDe } from './sesion'
import { invitations } from './tablas'

export const INTENTOS_PERMITIDOS = 5
const VENTANA_MIN = 15
export const PORTAL_CONSOLA = 'plataforma'
// Al entrar no se revisa la forma del correo: si no calza con ninguna cuenta, es «correo o clave incorrectos».
const correoAlEntrar = z.string({ error: 'Escribe el correo.' }).trim().toLowerCase().min(1, 'Escribe el correo.').max(160)

/** Los intentos fallidos con un correo en la ventana: al entrar y al cambiar la clave cuentan juntos. */
async function fallidosCon(base: Entorno['Variables']['base'], correo: string, ahora: Date) {
  const [{ fallidos }] = await base
    .select({ fallidos: count() })
    .from(events)
    .where(and(eq(events.eventType, 'user.failed_login'), gte(events.createdAt, new Date(ahora.getTime() - VENTANA_MIN * 60_000)), sql`${events.metadata}->>'correo' = ${correo}`))
  return fallidos
}

const anonimo = (c: Parameters<typeof ipDe>[0]) => ({ actorId: null, actorType: 'anonymous' as const, ipAddress: ipDe(c), userAgent: c.req.header('user-agent') ?? null })

export const rutasAcceso = new Hono<Entorno>()
  .post('/entrar', conDatos(z.object({ correo: correoAlEntrar, clave: z.string({ error: 'Escribe la clave.' }).min(1, 'Escribe la clave.').max(200), portal: z.string().max(60).optional() })), async (c) => {
    const { base, ahora } = c.var
    const { correo, clave, portal } = c.req.valid('json')
    // Los intentos con un mismo correo van de a uno (el cerrojo dura lo que su transacción): cien pedidos a la vez no
    // prueban cien claves antes de que se anote el primer fallo. El fallo se anota dentro y el rechazo va después, para
    // que la transacción lo guarde.
    const r = await base.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`entrar:${correo}`}))`)
      if ((await fallidosCon(tx, correo, ahora)) >= INTENTOS_PERMITIDOS) return { tipo: 'frenado' as const }

      const [admin] = portal && portal !== PORTAL_CONSOLA ? [] : await tx.select().from(platformAdmins).where(and(eq(platformAdmins.email, correo), eq(platformAdmins.active, true)))
      const cuentas =
        portal === PORTAL_CONSOLA
          ? []
          : await tx
              .select({ u: users, t: { nombre: tenants.name, slug: tenants.slug } })
              .from(users)
              .innerJoin(tenants, eq(tenants.id, users.tenantId))
              .where(and(eq(users.email, correo), ne(users.status, 'invited'), ne(tenants.status, 'cancelled'), portal ? eq(tenants.slug, portal) : undefined))
      const calzan: ({ tipo: 'platform_admin'; id: string } | { tipo: 'user'; id: string; tenantId: string; nombre: string; slug: string; bloqueado: boolean })[] = []
      if (admin && (await claveCorrecta(clave, admin.passwordHash))) calzan.push({ tipo: 'platform_admin', id: admin.id })
      for (const { u, t } of cuentas) if (await claveCorrecta(clave, u.passwordHash)) calzan.push({ tipo: 'user', id: u.id, tenantId: u.tenantId, nombre: t.nombre, slug: t.slug, bloqueado: u.status === 'blocked' })
      // Sin cuentas que probar, igual se gasta el tiempo de una: la respuesta no dice si el correo existe.
      if (!admin && !cuentas.length) await claveCorrecta(clave, null)

      if (!calzan.length) {
        const [cuenta] = cuentas
        await registrar(tx, anonimo(c), { tenantId: cuenta?.u.tenantId ?? null, eventType: 'user.failed_login', userId: cuenta?.u.id ?? null, metadata: { correo, motivo: cuentas.length || admin ? 'clave_incorrecta' : 'correo_desconocido' } })
        return { tipo: 'incorrecta' as const }
      }
      const usuarios = calzan.filter((x) => x.tipo === 'user')
      // La misma clave en varias rectificadoras: que elija a cuál entrar.
      if (calzan.length > 1) return { tipo: 'elegir' as const, elegir: [...(calzan.some((x) => x.tipo === 'platform_admin') ? [{ portal: PORTAL_CONSOLA, nombre: 'Consola de la plataforma' }] : []), ...usuarios.map((x) => ({ portal: x.slug, nombre: x.nombre }))] }
      const quien = calzan[0]
      if (quien.tipo === 'user' && quien.bloqueado) return { tipo: 'bloqueado' as const }
      await abrirSesion(c, tx, quien, ahora)
      if (quien.tipo === 'user') {
        await tx.update(users).set({ lastLoginAt: ahora, lastLoginIp: ipDe(c) }).where(eq(users.id, quien.id))
        await registrar(tx, { ...anonimo(c), actorId: quien.id, actorType: 'user' }, { tenantId: quien.tenantId, eventType: 'user.login', userId: quien.id, metadata: { metodo: 'clave' } })
      } else await registrar(tx, { ...anonimo(c), actorId: quien.id, actorType: 'platform_admin' }, { tenantId: null, eventType: 'user.login', metadata: { metodo: 'clave', equipo: true } })
      return { tipo: 'adentro' as const, quien }
    })
    if (r.tipo === 'frenado') throw rechazo(429, `Demasiados intentos fallidos con ese correo. Espera ${VENTANA_MIN} minutos y vuelve a probar.`)
    if (r.tipo === 'incorrecta') throw rechazo(401, 'Correo o clave incorrectos.')
    if (r.tipo === 'bloqueado') throw rechazo(403, 'Tu cuenta está bloqueada: habla con el administrador de tu organización.')
    if (r.tipo === 'elegir') return c.json({ elegir: r.elegir })
    const { quien } = r
    return c.json({ ok: true, destino: quien.tipo === 'platform_admin' ? '/plataforma' : `/c/${quien.slug}` })
  })

  /** Lo que dice una invitación antes de aceptarla: a quién y a qué rectificadora. */
  .get('/invitacion/:token', async (c) => {
    const inv = await invitacionVigente(c.var.base, c.req.param('token'), c.var.ahora)
    return c.json({ nombre: inv.nombre, correo: inv.correo, organizacion: inv.organizacion, vence: inv.vence.toISOString() })
  })

  /** Aceptar la invitación: la persona define su clave, queda activa y entra. */
  .post('/invitacion/:token', conDatos(z.object({ clave: z.string({ error: 'Escribe la clave.' }).max(200) })), async (c) => {
    const { base, ahora } = c.var
    const inv = await invitacionVigente(base, c.req.param('token'), ahora)
    const { clave } = c.req.valid('json')
    const falta = faltaDeLaClave(clave, inv.correo)
    if (falta) throw rechazo(400, falta)
    const hash = await cifrarClave(clave)
    await base.transaction(async (tx) => {
      // De un solo uso aunque lleguen dos pedidos a la vez: solo el primero la encuentra sin usar.
      const [usada] = await tx.update(invitations).set({ usedAt: ahora }).where(and(eq(invitations.id, inv.id), isNull(invitations.usedAt))).returning({ id: invitations.id })
      if (!usada) throw rechazo(404, 'Esta invitación ya no sirve: se usó, venció o se pidió otra. Pide un enlace nuevo a quien te invitó.')
      await tx.update(users).set({ passwordHash: hash, status: 'active', lastLoginAt: ahora, lastLoginIp: ipDe(c) }).where(and(eq(users.id, inv.userId), eq(users.status, 'invited')))
      await abrirSesion(c, tx, { tipo: 'user', id: inv.userId }, ahora)
      await registrar(tx, { ...anonimo(c), actorId: inv.userId, actorType: 'user' }, { tenantId: inv.tenantId, eventType: 'user.login', userId: inv.userId, metadata: { metodo: 'invitacion' } })
    })
    return c.json({ ok: true, destino: `/c/${inv.slug}` })
  })

  /** Cambiar la propia clave, con la de ahora. Cierra las otras sesiones y abre una nueva aquí. */
  .post('/clave', conDatos(z.object({ actual: z.string().max(200), nueva: z.string().max(200) })), async (c) => {
    const { base, ahora } = c.var
    const actor = c.get('actor')
    if (!actor) throw rechazo(401, 'Inicia sesión para continuar.')
    if (actor.tipo === 'tenant' && actor.impersonacion) throw rechazo(403, 'Entrando como otra persona no se cambia su clave.')
    const { actual, nueva } = c.req.valid('json')
    const delEquipo = actor.tipo === 'plataforma'
    const [fila] = delEquipo
      ? await base.select({ hash: platformAdmins.passwordHash, correo: platformAdmins.email }).from(platformAdmins).where(eq(platformAdmins.id, actor.id))
      : await base.select({ hash: users.passwordHash, correo: users.email }).from(users).where(eq(users.id, actor.id))
    // Con una sesión ajena (un celular prestado) no se puede probar la clave sin fin: cuenta como un intento de entrar.
    const correo = fila?.correo.toLowerCase() ?? ''
    const fallo = await base.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`entrar:${correo}`}))`)
      if ((await fallidosCon(tx, correo, ahora)) >= INTENTOS_PERMITIDOS) return 'frenado' as const
      if (await claveCorrecta(actual, fila?.hash ?? null)) return null
      await registrar(tx, origenDe(c), { tenantId: actor.tipo === 'tenant' ? actor.tenantId : null, eventType: 'user.failed_login', userId: actor.tipo === 'tenant' ? actor.id : null, metadata: { correo, motivo: 'clave_actual_incorrecta' } })
      return 'incorrecta' as const
    })
    if (fallo === 'frenado') throw rechazo(429, `Demasiados intentos fallidos. Espera ${VENTANA_MIN} minutos y vuelve a probar.`)
    if (fallo) throw rechazo(400, 'La clave de ahora no es esa.')
    const falta = faltaDeLaClave(nueva, fila.correo)
    if (falta) throw rechazo(400, falta)
    const hash = await cifrarClave(nueva)
    await base.transaction(async (tx) => {
      if (delEquipo) await tx.update(platformAdmins).set({ passwordHash: hash }).where(eq(platformAdmins.id, actor.id))
      else await tx.update(users).set({ passwordHash: hash }).where(eq(users.id, actor.id))
      await cerrarSesionesDe(tx, actor.id, ahora)
      await abrirSesion(c, tx, { tipo: delEquipo ? 'platform_admin' : 'user', id: actor.id }, ahora)
      await registrar(tx, origenDe(c), { tenantId: actor.tipo === 'tenant' ? actor.tenantId : null, eventType: 'user.password_changed', userId: actor.tipo === 'tenant' ? actor.id : null })
    })
    return c.json({ ok: true })
  })

/** Una invitación sin usar y sin vencer, con su persona y su rectificadora. Si no sirve, «no existe». */
async function invitacionVigente(base: Entorno['Variables']['base'], token: string, ahora: Date) {
  const [fila] = await base
    .select({ i: invitations, nombre: users.name, correo: users.email, estado: users.status, organizacion: tenants.name, slug: tenants.slug, estadoTenant: tenants.status })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.userId))
    .innerJoin(tenants, eq(tenants.id, invitations.tenantId))
    .where(and(eq(invitations.tokenHash, huellaDe(token)), isNull(invitations.usedAt), gt(invitations.expiresAt, ahora)))
  if (!fila || fila.estado !== 'invited' || fila.estadoTenant === 'cancelled') throw rechazo(404, 'Esta invitación ya no sirve: se usó, venció o se pidió otra. Pide un enlace nuevo a quien te invitó.')
  return { id: fila.i.id, userId: fila.i.userId, tenantId: fila.i.tenantId, nombre: fila.nombre, correo: fila.correo, organizacion: fila.organizacion, slug: fila.slug, vence: fila.i.expiresAt }
}
