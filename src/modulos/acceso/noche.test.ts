// Lo que se arregló en la revisión del acceso: los intentos a la vez, la invitación de un solo uso, la clave de ahora y
// lo que el panel del cliente no debe ver.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { registrar } from '../eventos/registrar'
import { users } from '../usuarios/tablas'
import { cifrarClave, faltaDeLaClave } from './claves'
import { INTENTOS_PERMITIDOS } from './rutas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
const CLAVE = 'motor diesel 6'
const conClave = async (p: Prueba, id: string) => p.base.update(users).set({ passwordHash: await cifrarClave(CLAVE) }).where(eq(users.id, id))
const galleta = (r: Awaited<ReturnType<Prueba['pedir']>>) => /(?:^|,\s*)sesion=([^;]+)/.exec(r.encabezados.get('set-cookie') ?? '')?.[1] ?? null

describe('el límite de intentos', () => {
  it('diez claves a la vez con un correo: solo se prueban cinco', async () => {
    const p = await armarPrueba()
    await conClave(p, 'us_a_admin')
    const r = await Promise.all(Array.from({ length: 10 }, (_, i) => p.pedir(null, 'POST', '/api/entrar', { correo: 'us_a_admin@tn_a.test', clave: `no es esta ${i}` })))
    expect(r.filter((x) => x.estado === 401)).toHaveLength(INTENTOS_PERMITIDOS)
    expect(r.filter((x) => x.estado === 429)).toHaveLength(10 - INTENTOS_PERMITIDOS)
    expect(await p.eventos('user.failed_login')).toHaveLength(INTENTOS_PERMITIDOS)
  })

  it('cambiar la clave con una sesión ajena tampoco deja probar sin fin', async () => {
    const p = await armarPrueba()
    await conClave(p, 'us_a_member')
    const sesion = galleta(await p.pedir(null, 'POST', '/api/entrar', { correo: 'us_a_member@tn_a.test', clave: CLAVE }))!
    for (let i = 0; i < INTENTOS_PERMITIDOS; i++) expect((await p.pedir(null, 'POST', '/api/clave', { actual: `adivina ${i}`, nueva: 'otra clave larga' }, { sesion })).estado).toBe(400)
    expect((await p.pedir(null, 'POST', '/api/clave', { actual: CLAVE, nueva: 'otra clave larga' }, { sesion })).estado).toBe(429)
    const [e] = await p.eventos('user.failed_login')
    expect(e).toMatchObject({ tenantId: 'tn_a', userId: 'us_a_member', metadata: { motivo: 'clave_actual_incorrecta' } })
  })
})

describe('la invitación y la clave', () => {
  it('dos que aceptan el mismo enlace a la vez: entra uno solo', async () => {
    const p = await armarPrueba()
    const { enlace } = (await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Pedro Gallardo', correo: 'pedro@a.test', rol: 'technician' })).cuerpo
    const r = await Promise.all([p.aceptar(enlace, 'primera clave larga'), p.aceptar(enlace, 'segunda clave larga')])
    expect(r.map((x) => x.estado).sort()).toEqual([200, 404])
    expect((await p.eventos('user.login')).filter((e) => (e.metadata as { metodo?: string }).metodo === 'invitacion')).toHaveLength(1)
  })

  it('ocho espacios o un carácter repetido no son una clave', () => {
    expect(faltaDeLaClave('        ')).toContain('repetido')
    expect(faltaDeLaClave('aaaaaaaa')).toContain('repetido')
    expect(faltaDeLaClave('motor diesel 6')).toBeNull()
  })

  it('un campo que se pasa de largo responde en castellano', async () => {
    const p = await armarPrueba()
    const r = await p.pedir(null, 'POST', '/api/entrar', { correo: `${'a'.repeat(200)}@a.test`, clave: 'x' })
    expect(r.estado).toBe(400)
    expect(r.cuerpo.error).not.toMatch(/too big|expected/i)
  })
})

describe('el portal y el panel del cliente', () => {
  it('la dirección con mayúsculas es el mismo portal, sin anotar un intento falso', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('us_a_member', 'GET', '/api/servicio/inicio', undefined, {}, { 'x-portal': 'TN_A' })).estado).toBe(200)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(0)
  })

  it('el cliente no ve los intentos sin permiso del equipo ni el texto crudo de un error', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('adm_sin', 'POST', '/api/plataforma/tenants/tn_a/plan', { plan: 'enterprise', motivo: 'Prueba de un permiso que falta' })).estado).toBe(403)
    await registrar(p.base, { actorId: 'us_a_member', actorType: 'user', ipAddress: null, userAgent: null }, { tenantId: 'tn_a', eventType: 'system.error', metadata: { mensaje: 'duplicate key value violates unique constraint "work_orders_pkey"' } })
    const auditoria = (await p.pedir('us_a_admin', 'GET', '/api/organizacion/eventos')).cuerpo
    const tipos = auditoria.filas.map((e: { eventType: string }) => e.eventType)
    expect(tipos).not.toContain('security.permission_denied')
    expect(tipos).not.toContain('system.error')
    // La consola sí los ve.
    const consola = (await p.pedir('adm_todo', 'GET', '/api/plataforma/tenants/tn_a/eventos')).cuerpo
    expect(consola.filas.map((e: { eventType: string }) => e.eventType)).toEqual(expect.arrayContaining(['security.permission_denied', 'system.error']))
  })
})
