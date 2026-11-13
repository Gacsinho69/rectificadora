import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { platformAdmins, users } from '../usuarios/tablas'
import { cifrarClave } from './claves'
import { INTENTOS_PERMITIDOS } from './rutas'
import { invitations, sessions } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type Respuesta = Awaited<ReturnType<Prueba['pedir']>>

const CLAVE = 'motor diesel 6'
/** El secreto de la cookie «sesion» que deja una respuesta. */
const galleta = (r: Respuesta) => /(?:^|,\s*)sesion=([^;]+)/.exec(r.encabezados.get('set-cookie') ?? '')?.[1] ?? null
const conSesion = (p: Prueba, sesion: string, metodo: string, ruta: string, datos?: unknown) => p.pedir(null, metodo, ruta, datos, { sesion })
const yo = async (p: Prueba, sesion: string) => (await conSesion(p, sesion, 'GET', '/api/yo')).cuerpo.actor as { id: string; tipo: string } | null
const entrar = (p: Prueba, correo: string, clave: string, portal?: string) => p.pedir(null, 'POST', '/api/entrar', { correo, clave, ...(portal ? { portal } : {}) })
async function conClave(p: Prueba, id: string, clave = CLAVE) {
  const hash = await cifrarClave(clave)
  if (id.startsWith('adm_')) await p.base.update(platformAdmins).set({ passwordHash: hash }).where(eq(platformAdmins.id, id))
  else await p.base.update(users).set({ passwordHash: hash }).where(eq(users.id, id))
}

describe('la invitación', () => {
  it('quien la recibe ve a qué organización entra, define su clave y entra; el enlace sirve una vez', async () => {
    const p = await armarPrueba()
    const nuevo = (await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Pedro Gallardo', correo: 'pedro@a.test', rol: 'technician' })).cuerpo
    const { enlace } = nuevo
    // Se guarda solo la huella: el secreto del enlace no está en la base.
    const [inv] = await p.base.select().from(invitations).where(eq(invitations.userId, nuevo.id))
    expect(inv.tokenHash).not.toContain(enlace.split('/').at(-1))
    expect(inv.expiresAt.toISOString()).toBe('2026-11-18T15:00:00.000Z')

    expect((await p.pedir(null, 'GET', `/api${enlace}`)).cuerpo).toMatchObject({ nombre: 'Pedro Gallardo', correo: 'pedro@a.test', organizacion: 'Cliente A' })
    expect((await p.aceptar(enlace, 'corta')).cuerpo.error).toContain('al menos 8')
    expect((await p.aceptar(enlace, 'pedro@a.test')).cuerpo.error).toContain('no puede ser el correo')
    // Una invitación no deja entrar sin aceptarla, aunque se adivine la clave.
    expect((await entrar(p, 'pedro@a.test', CLAVE)).estado).toBe(401)

    const r = await p.aceptar(enlace, CLAVE)
    expect(r.cuerpo).toEqual({ ok: true, destino: '/c/tn_a' })
    expect(r.encabezados.get('set-cookie')).toMatch(/sesion=.+HttpOnly.*SameSite=Lax/)
    const sesion = galleta(r)!
    expect(await yo(p, sesion)).toMatchObject({ id: nuevo.id, tipo: 'tenant' })
    const [u] = await p.base.select().from(users).where(eq(users.id, nuevo.id))
    expect(u.status).toBe('active')
    expect(u.passwordHash).toMatch(/^scrypt\$/)
    const [login] = (await p.eventos('user.login')).filter((e) => e.userId === nuevo.id)
    expect(login).toMatchObject({ tenantId: 'tn_a', actorType: 'user', metadata: { metodo: 'invitacion' } })

    // Usada, ya no sirve; y la persona entra con su correo y su clave.
    expect((await p.pedir(null, 'GET', `/api${enlace}`)).estado).toBe(404)
    expect((await p.aceptar(enlace, 'otra clave larga')).estado).toBe(404)
    expect((await entrar(p, 'pedro@a.test', CLAVE)).cuerpo).toEqual({ ok: true, destino: '/c/tn_a' })
  })

  it('vence a los 7 días; un enlace nuevo anula el anterior; anularla libera su lugar', async () => {
    const p = await armarPrueba()
    const nuevo = (await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Luis Carrasco', correo: 'luis@a.test', rol: 'planner' })).cuerpo
    const otro = (await p.pedir('us_a_admin', 'POST', `/api/organizacion/usuarios/${nuevo.id}/invitacion`)).cuerpo
    expect(otro.enlace).not.toBe(nuevo.enlace)
    expect((await p.pedir(null, 'GET', `/api${nuevo.enlace}`)).estado).toBe(404)
    expect((await p.pedir(null, 'GET', `/api${otro.enlace}`)).estado).toBe(200)
    expect((await p.eventos('user.invited')).filter((e) => e.userId === nuevo.id)).toHaveLength(2)
    // Vencida, no sirve.
    await p.base.update(invitations).set({ expiresAt: new Date('2026-11-10T00:00:00Z') }).where(eq(invitations.userId, nuevo.id))
    expect((await p.aceptar(otro.enlace)).estado).toBe(404)

    const cupo = async () => (await p.pedir('us_a_admin', 'GET', '/api/organizacion/usuarios/cupo')).cuerpo.usados
    expect(await cupo()).toBe(5)
    expect((await p.pedir('us_a_admin', 'DELETE', `/api/organizacion/usuarios/${nuevo.id}/invitacion`)).estado).toBe(200)
    expect(await cupo()).toBe(4)
    const [anulada] = await p.eventos('user.deleted')
    expect(anulada).toMatchObject({ tenantId: 'tn_a', targetId: nuevo.id, metadata: { correo: 'luis@a.test', invitacion_anulada: true } })
    // Quien ya entró no se anula (se bloquea), y no se le manda otro enlace.
    expect((await p.pedir('us_a_admin', 'DELETE', '/api/organizacion/usuarios/us_a_member/invitacion')).estado).toBe(409)
    expect((await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios/us_a_member/invitacion')).estado).toBe(409)
  })

  it('aislamiento: otra organización no pide enlaces ni anula invitaciones ajenas; la consola, con permiso y motivo', async () => {
    const p = await armarPrueba()
    const nuevo = (await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Luis Carrasco', correo: 'luis@a.test', rol: 'planner' })).cuerpo
    expect((await p.pedir('us_b_admin', 'POST', `/api/organizacion/usuarios/${nuevo.id}/invitacion`)).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'DELETE', `/api/organizacion/usuarios/${nuevo.id}/invitacion`)).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(2)
    // El técnico de la misma organización tampoco: el panel es del administrador.
    expect((await p.pedir('us_a_member', 'POST', `/api/organizacion/usuarios/${nuevo.id}/invitacion`)).estado).toBe(403)
    expect((await p.pedir(null, 'GET', `/api${nuevo.enlace}`)).estado).toBe(200)

    const motivo = 'Se le perdió el enlace, llamó a soporte'
    expect((await p.pedir('adm_sin', 'POST', `/api/plataforma/tenants/tn_a/usuarios/${nuevo.id}/invitacion`, { motivo })).estado).toBe(403)
    expect((await p.pedir('adm_todo', 'POST', `/api/plataforma/tenants/tn_b/usuarios/${nuevo.id}/invitacion`, { motivo })).estado).toBe(404)
    const r = await p.pedir('adm_todo', 'POST', `/api/plataforma/tenants/tn_a/usuarios/${nuevo.id}/invitacion`, { motivo })
    expect(r.cuerpo.enlace).toMatch(/^\/invitacion\//)
    const ultimo = (await p.eventos('user.invited')).find((e) => e.actorId === 'adm_todo')
    expect(ultimo).toMatchObject({ tenantId: 'tn_a', userId: nuevo.id, metadata: { motivo, enlace_nuevo: true } })
  })
})

describe('entrar con correo y clave', () => {
  it('abre una sesión que dice quién es; salir la cierra; vence a los 30 días', async () => {
    const p = await armarPrueba()
    await conClave(p, 'us_a_jefe')
    const r = await entrar(p, ' US_A_JEFE@tn_a.test ', CLAVE)
    expect(r.cuerpo).toEqual({ ok: true, destino: '/c/tn_a' })
    const sesion = galleta(r)!
    expect(await yo(p, sesion)).toMatchObject({ id: 'us_a_jefe', tipo: 'tenant', tenantId: 'tn_a' })
    // Con la sesión trabaja en su rectificadora, y solo en ella.
    expect((await conSesion(p, sesion, 'GET', '/api/servicio/ot')).estado).toBe(200)
    const [s] = await p.base.select().from(sessions).where(eq(sessions.actorId, 'us_a_jefe'))
    expect(s.tokenHash).not.toBe(sesion)
    expect(s.expiresAt.toISOString()).toBe('2026-12-11T15:00:00.000Z')
    const [u] = await p.base.select().from(users).where(eq(users.id, 'us_a_jefe'))
    expect(u).toMatchObject({ lastLoginAt: p.ahora, lastLoginIp: '203.0.113.9' })
    const [login] = await p.eventos('user.login')
    expect(login).toMatchObject({ tenantId: 'tn_a', actorId: 'us_a_jefe', actorType: 'user', metadata: { metodo: 'clave' } })

    expect((await conSesion(p, sesion, 'POST', '/api/salir')).estado).toBe(200)
    expect(await yo(p, sesion)).toBeNull()
    expect((await conSesion(p, sesion, 'GET', '/api/servicio/ot')).estado).toBe(401)

    const otra = galleta(await entrar(p, 'us_a_jefe@tn_a.test', CLAVE))!
    expect(await yo(p, otra)).not.toBeNull()
    await p.base.update(sessions).set({ expiresAt: new Date('2026-11-11T14:59:00Z') })
    expect(await yo(p, otra)).toBeNull()
  })

  it('una clave mala no dice si el correo existe, queda en la auditoría y a los 5 intentos frena', async () => {
    const p = await armarPrueba()
    await conClave(p, 'us_a_admin')
    const mala = await entrar(p, 'us_a_admin@tn_a.test', 'no es esta')
    const nadie = await entrar(p, 'nadie@ninguna.test', 'no es esta')
    expect([mala.estado, nadie.estado]).toEqual([401, 401])
    expect(mala.cuerpo.error).toBe('Correo o clave incorrectos.')
    expect(nadie.cuerpo.error).toBe(mala.cuerpo.error)
    expect(galleta(mala)).toBeNull()
    const fallidos = await p.eventos('user.failed_login')
    expect(fallidos.find((e) => e.userId === 'us_a_admin')).toMatchObject({ tenantId: 'tn_a', actorType: 'anonymous', metadata: { correo: 'us_a_admin@tn_a.test', motivo: 'clave_incorrecta' } })
    expect(fallidos.find((e) => !e.userId)).toMatchObject({ tenantId: null, metadata: { correo: 'nadie@ninguna.test', motivo: 'correo_desconocido' } })
    // El administrador de la organización ve los intentos contra su gente; los de otra, no.
    const auditoria = (await p.pedir('us_a_admin', 'GET', '/api/organizacion/eventos?tipo=user.failed_login')).cuerpo
    expect(JSON.stringify(auditoria)).toContain('us_a_admin@tn_a.test')
    expect(JSON.stringify(auditoria)).not.toContain('nadie@ninguna.test')

    for (let i = 1; i < INTENTOS_PERMITIDOS; i++) await entrar(p, 'us_a_admin@tn_a.test', 'tampoco esta')
    const frenado = await entrar(p, 'us_a_admin@tn_a.test', CLAVE)
    expect(frenado.estado).toBe(429)
    expect(frenado.cuerpo.error).toContain('15 minutos')
    // Otro correo sigue entrando.
    await conClave(p, 'us_a_member')
    expect((await entrar(p, 'us_a_member@tn_a.test', CLAVE)).estado).toBe(200)
  })

  it('bloqueada no entra, y bloquearla cierra sus sesiones; cancelada la organización, tampoco', async () => {
    const p = await armarPrueba()
    await conClave(p, 'us_a_member')
    const sesion = galleta(await entrar(p, 'us_a_member@tn_a.test', CLAVE))!
    expect((await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios/us_a_member/bloqueo', { bloqueado: true, motivo: 'Se fue del taller' })).estado).toBe(200)
    const [s] = await p.base.select().from(sessions).where(eq(sessions.actorId, 'us_a_member'))
    expect(s.revokedAt).not.toBeNull()
    expect(await yo(p, sesion)).toBeNull()
    const bloqueada = await entrar(p, 'us_a_member@tn_a.test', CLAVE)
    expect(bloqueada.estado).toBe(403)
    expect(bloqueada.cuerpo.error).toContain('bloqueada')
    // Desbloquearla no revive la sesión de antes: entra de nuevo.
    await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios/us_a_member/bloqueo', { bloqueado: false })
    expect(await yo(p, sesion)).toBeNull()
    expect((await entrar(p, 'us_a_member@tn_a.test', CLAVE)).estado).toBe(200)

    await conClave(p, 'us_b_admin')
    await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_b/estado', { estado: 'cancelled', motivo: 'Dejó de pagar hace meses' })
    expect((await entrar(p, 'us_b_admin@tn_b.test', CLAVE)).estado).toBe(401)
  })

  it('el mismo correo en dos rectificadoras (o en el equipo): elige a cuál entrar, y entra solo a esa', async () => {
    const p = await armarPrueba()
    await p.base.update(users).set({ email: 'rosa@correo.test' }).where(eq(users.id, 'us_a_admin'))
    await p.base.update(users).set({ email: 'rosa@correo.test' }).where(eq(users.id, 'us_b_member'))
    await p.base.update(platformAdmins).set({ email: 'rosa@correo.test' }).where(eq(platformAdmins.id, 'adm_sin'))
    for (const id of ['us_a_admin', 'us_b_member', 'adm_sin']) await conClave(p, id)

    const elegir = await entrar(p, 'rosa@correo.test', CLAVE)
    expect(galleta(elegir)).toBeNull()
    expect(elegir.cuerpo.elegir).toEqual([
      { portal: 'plataforma', nombre: 'Consola de la plataforma' },
      { portal: 'tn_a', nombre: 'Cliente A' },
      { portal: 'tn_b', nombre: 'Cliente B' },
    ])
    const enB = await entrar(p, 'rosa@correo.test', CLAVE, 'tn_b')
    expect(enB.cuerpo.destino).toBe('/c/tn_b')
    expect(await yo(p, galleta(enB)!)).toMatchObject({ id: 'us_b_member', tenantId: 'tn_b' })
    const consola = await entrar(p, 'rosa@correo.test', CLAVE, 'plataforma')
    expect(consola.cuerpo.destino).toBe('/plataforma')
    expect(await yo(p, galleta(consola)!)).toMatchObject({ id: 'adm_sin', tipo: 'plataforma' })
    // Con otra clave en una de ellas, entra directo a la que calza.
    await conClave(p, 'us_b_member', 'otra clave de b')
    await conClave(p, 'adm_sin', 'otra clave del equipo')
    expect((await entrar(p, 'rosa@correo.test', CLAVE)).cuerpo).toEqual({ ok: true, destino: '/c/tn_a' })
    // Un portal que no es suyo no la deja entrar con su clave de otro lado.
    expect((await entrar(p, 'rosa@correo.test', 'otra clave de b', 'tn_a')).estado).toBe(401)
  })

  it('cambiar la clave pide la de ahora y cierra las demás sesiones', async () => {
    const p = await armarPrueba()
    await conClave(p, 'us_a_admin')
    const enElTaller = galleta(await entrar(p, 'us_a_admin@tn_a.test', CLAVE))!
    const enLaCasa = galleta(await entrar(p, 'us_a_admin@tn_a.test', CLAVE))!
    expect((await conSesion(p, enLaCasa, 'POST', '/api/clave', { actual: 'no es', nueva: 'nueva clave 2026' })).cuerpo.error).toBe('La clave de ahora no es esa.')
    expect((await conSesion(p, enLaCasa, 'POST', '/api/clave', { actual: CLAVE, nueva: 'corta' })).estado).toBe(400)
    const r = await conSesion(p, enLaCasa, 'POST', '/api/clave', { actual: CLAVE, nueva: 'nueva clave 2026' })
    expect(r.estado).toBe(200)
    expect(await yo(p, enElTaller)).toBeNull()
    expect(await yo(p, enLaCasa)).toBeNull()
    expect(await yo(p, galleta(r)!)).toMatchObject({ id: 'us_a_admin' })
    expect((await entrar(p, 'us_a_admin@tn_a.test', CLAVE)).estado).toBe(401)
    expect((await entrar(p, 'us_a_admin@tn_a.test', 'nueva clave 2026')).estado).toBe(200)
    expect(await p.eventos('user.password_changed')).toMatchObject([{ tenantId: 'tn_a', actorId: 'us_a_admin', userId: 'us_a_admin' }])
    // Sin sesión, no se cambia nada.
    expect((await p.pedir(null, 'POST', '/api/clave', { actual: CLAVE, nueva: 'otra clave 2026' })).estado).toBe(401)
  })
})
