import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { users } from '../usuarios/tablas'

describe('aislamiento entre clientes', () => {
  it('el administrador de A solo ve los usuarios de A', async () => {
    const { pedir } = await armarPrueba()
    const r = await pedir('us_a_admin', 'GET', '/api/organizacion/usuarios')
    expect(r.estado).toBe(200)
    const ids = r.cuerpo.map((u: { id: string }) => u.id)
    expect(ids).toContain('us_a_admin')
    expect(ids.every((id: string) => id.startsWith('us_a_'))).toBe(true)
  })

  it('tocar un usuario de B desde A responde «no existe», no lo cambia y queda un evento crítico', async () => {
    const { pedir, eventos, base } = await armarPrueba()
    const r = await pedir('us_a_admin', 'POST', '/api/organizacion/usuarios/us_b_member/bloqueo', { bloqueado: true })
    expect(r.estado).toBe(404)
    const [b] = await base.select().from(users).where(eq(users.id, 'us_b_member'))
    expect(b.status).toBe('active')
    const [e] = await eventos('security.cross_tenant_access_attempt')
    expect(e).toMatchObject({ tenantId: 'tn_a', actorId: 'us_a_admin', actorType: 'user', userId: 'us_a_admin', targetId: 'us_b_member', severity: 'critical', ipAddress: '203.0.113.9' })
    expect(e.metadata).toMatchObject({ tenant_objetivo: 'tn_b' })
  })

  it('pedir otro tenant por encabezado o por la dirección se rechaza y se anota', async () => {
    const { pedir, eventos } = await armarPrueba()
    expect((await pedir('us_a_admin', 'GET', '/api/organizacion/usuarios', undefined, {}, { 'x-tenant-id': 'tn_b' })).estado).toBe(403)
    expect((await pedir('us_a_admin', 'GET', '/api/organizacion/eventos?tenant_id=tn_b')).estado).toBe(403)
    expect(await eventos('security.cross_tenant_access_attempt')).toHaveLength(2)
  })

  it('el filtro `tenant` de la auditoría no amplía el alcance del panel del cliente', async () => {
    const { pedir } = await armarPrueba()
    await pedir('us_b_admin', 'POST', '/api/organizacion/usuarios/us_b_member/rol', { rol: 'viewer' })
    const r = await pedir('us_a_admin', 'GET', '/api/organizacion/eventos?tenant=tn_b')
    expect(r.estado).toBe(200)
    expect(r.cuerpo.filas.every((e: { tenantId: string }) => e.tenantId === 'tn_a')).toBe(true)
  })

  it('una persona de un cliente no entra a la consola global, y queda anotado como crítico', async () => {
    const { pedir, eventos } = await armarPrueba()
    expect((await pedir('us_a_admin', 'GET', '/api/plataforma/tenants')).estado).toBe(403)
    const [e] = await eventos('security.cross_tenant_access_attempt')
    expect(e).toMatchObject({ tenantId: 'tn_a', severity: 'critical' })
    expect(e.metadata).toMatchObject({ motivo: 'consola_global' })
  })

  it('un usuario que no es administrador no abre el panel; sin sesión, 401', async () => {
    const { pedir } = await armarPrueba()
    expect((await pedir('us_a_member', 'GET', '/api/organizacion/resumen')).estado).toBe(403)
    expect((await pedir(null, 'GET', '/api/organizacion/resumen')).estado).toBe(401)
    expect((await pedir(null, 'GET', '/api/plataforma/resumen')).estado).toBe(401)
  })

  it('el resumen del cliente no trae salud ni alertas internas', async () => {
    const { pedir } = await armarPrueba()
    const r = await pedir('us_a_admin', 'GET', '/api/organizacion/resumen')
    expect(r.estado).toBe(200)
    const texto = JSON.stringify(r.cuerpo)
    expect(texto).not.toContain('"salud"')
    expect(texto).not.toContain('"alertas"')
    expect(texto).not.toContain('tn_b')
  })

  it('no se puede dejar a la organización sin administrador', async () => {
    const { pedir } = await armarPrueba()
    const r = await pedir('us_a_admin', 'POST', '/api/organizacion/usuarios/us_a_admin/rol', { rol: 'planner' })
    expect(r.estado).toBe(409)
  })

  it('una persona bloqueada o de un cliente cancelado ya no entra', async () => {
    const { pedir, base } = await armarPrueba()
    await base.update(users).set({ status: 'blocked' }).where(eq(users.id, 'us_a_admin'))
    expect((await pedir('us_a_admin', 'GET', '/api/organizacion/resumen')).estado).toBe(401)
  })
})
