// Lo que se arregló en la revisión del panel de cada organización: lo del equipo que el cliente no ve, los bloqueos de la
// plataforma, el último administrador desde la consola y las invitaciones.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { users } from '../usuarios/tablas'

const motivo = 'Prueba de la acción con su motivo'

describe('lo que el cliente ve de lo que hizo el equipo', () => {
  it('la auditoría del cliente dice quién del equipo y qué, sin su IP ni su navegador', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/usuarios', { nombre: 'Rosa Muñoz', correo: 'rosa@a.test', rol: 'technician', motivo })).estado).toBe(200)
    const filas = (await p.pedir('us_a_admin', 'GET', '/api/organizacion/eventos?tipo=user.invited')).cuerpo.filas
    expect(filas[0]).toMatchObject({ actorType: 'platform_admin', ipAddress: null, userAgent: null })
    expect(filas[0].actorNombre).toContain('Equipo')
    // La consola sí guarda y ve la IP.
    const consola = (await p.pedir('adm_todo', 'GET', '/api/plataforma/tenants/tn_a/eventos?tipo=user.invited&completo=1')).cuerpo.filas
    expect(consola[0].ipAddress).not.toBeNull()
  })
})

describe('los bloqueos y el último administrador', () => {
  it('a quien bloqueó la plataforma, el administrador del cliente no lo desbloquea', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/usuarios/us_a_member/bloqueo', { bloqueado: true, motivo })).estado).toBe(200)
    const r = await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios/us_a_member/bloqueo', { bloqueado: false })
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('equipo de la plataforma')
    // Lo que bloqueó el propio cliente, sí.
    await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios/us_a_jefe/bloqueo', { bloqueado: true })
    expect((await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios/us_a_jefe/bloqueo', { bloqueado: false })).estado).toBe(200)
  })

  it('la consola no deja al cliente sin administrador activo', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/usuarios/us_a_admin/bloqueo', { bloqueado: true, motivo })).estado).toBe(409)
    expect((await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/usuarios/us_a_admin/rol', { rol: 'technician', motivo })).estado).toBe(409)
    const [admin] = await p.base.select().from(users).where(eq(users.id, 'us_a_admin'))
    expect(admin).toMatchObject({ status: 'active', role: 'admin' })
  })
})

describe('las invitaciones', () => {
  it('anular y aceptar a la vez: nunca se borra a quien ya entró', async () => {
    const p = await armarPrueba()
    const { id, enlace } = (await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Pedro Gallardo', correo: 'pedro@a.test', rol: 'technician' })).cuerpo
    const [anular, aceptar] = await Promise.all([p.pedir('us_a_admin', 'DELETE', `/api/organizacion/usuarios/${id}/invitacion`), p.aceptar(enlace, 'clave del taller')])
    const [quedo] = await p.base.select().from(users).where(eq(users.id, id))
    if (aceptar.estado === 200) {
      expect(anular.estado).toBe(409)
      expect(quedo?.status).toBe('active')
    } else expect(quedo).toBeUndefined()
  })

  it('un enlace nuevo actualiza la fecha de envío', async () => {
    const p = await armarPrueba()
    const { id } = (await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Pedro Gallardo', correo: 'pedro@a.test', rol: 'technician' })).cuerpo
    await p.base.update(users).set({ invitedAt: new Date('2026-11-01T12:00:00Z') }).where(eq(users.id, id))
    await p.pedir('us_a_admin', 'POST', `/api/organizacion/usuarios/${id}/invitacion`)
    const [u] = await p.base.select().from(users).where(eq(users.id, id))
    expect(u.invitedAt?.toISOString()).toBe(p.ahora.toISOString())
  })

  it('el mismo correo de alguien invitado dice qué hacer', async () => {
    const p = await armarPrueba()
    await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Pedro Gallardo', correo: 'pedro@a.test', rol: 'technician' })
    const r = await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Pedro G.', correo: 'pedro@a.test', rol: 'technician' })
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('Enlace nuevo')
  })
})
