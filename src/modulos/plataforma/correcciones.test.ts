import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { sinSecretos } from '../../produccion/app'
import { registrar } from '../eventos/registrar'
import { PLANES } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'

const motivo = 'Prueba de la acción con su motivo'

describe('la consola de la plataforma', () => {
  it('un cliente en prueba que se activa empieza a pagar su plan', async () => {
    const { pedir, base, eventos } = await armarPrueba()
    await base.update(tenants).set({ status: 'trial', mrr: 0, billingStatus: 'none', nextBillingAt: null }).where(eq(tenants.id, 'tn_a'))
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/estado', { estado: 'active', motivo })).estado).toBe(200)
    const [t] = await base.select().from(tenants).where(eq(tenants.id, 'tn_a'))
    expect(t).toMatchObject({ status: 'active', mrr: PLANES.pro.precio, billingStatus: 'paid' })
    expect(t.nextBillingAt).not.toBeNull()
    const [e] = await eventos('tenant.updated')
    expect(e.metadata).toMatchObject({ antes: { estado: 'trial', mrr: 0 }, despues: { estado: 'active', mrr: PLANES.pro.precio } })
  })

  it('un cliente cancelado con pago vencido no suma al MRR en riesgo', async () => {
    const { pedir, base } = await armarPrueba()
    await base.update(tenants).set({ status: 'cancelled', billingStatus: 'past_due' }).where(eq(tenants.id, 'tn_a'))
    expect((await pedir('adm_todo', 'GET', '/api/plataforma/resumen')).cuerpo.mrr.enRiesgo).toBe(0)
  })

  it('encender o apagar una función pide su motivo', async () => {
    const { pedir } = await armarPrueba()
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/funciones', { funcion: 'supplies', activa: false })).estado).toBe(400)
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/funciones', { funcion: 'supplies', activa: false, motivo })).estado).toBe(200)
  })

  it('sin pedir lo completo, la ciudad de cada IP no se muestra', async () => {
    const { pedir, base } = await armarPrueba()
    await registrar(base, { actorType: 'user', actorId: 'us_a_admin', ipAddress: '190.45.12.34', userAgent: null }, { tenantId: 'tn_a', eventType: 'user.login', userId: 'us_a_admin', metadata: { pais: 'Chile', ciudad: 'Coquimbo' } })
    const [ip] = (await pedir('adm_todo', 'GET', '/api/plataforma/tenants/tn_a/seguridad')).cuerpo.ips
    expect(ip).toMatchObject({ pais: 'Chile', ciudad: null })
    expect(ip.ip).not.toBe('190.45.12.34')
  })
})

describe('lo que es solo de la plataforma', () => {
  it('el panel del cliente no ve sus intentos de abrir lo de otro cliente (dirían que el id existe)', async () => {
    const { pedir, eventos } = await armarPrueba()
    expect((await pedir('us_a_admin', 'GET', '/api/servicio/ot/no-existe')).estado).toBe(404)
    expect((await pedir('us_a_admin', 'GET', '/api/servicio/clientes/cl_b/ot')).estado).toBe(404)
    expect(await eventos('security.cross_tenant_access_attempt')).toHaveLength(1)
    const auditoria = (await pedir('us_a_admin', 'GET', '/api/organizacion/eventos?categoria=seguridad')).cuerpo
    expect(auditoria.filas.some((e: { eventType: string }) => e.eventType === 'security.cross_tenant_access_attempt')).toBe(false)
    const seguridad = (await pedir('us_a_admin', 'GET', '/api/organizacion/seguridad')).cuerpo
    expect(seguridad.sensibles.some((e: { eventType: string }) => e.eventType === 'security.cross_tenant_access_attempt')).toBe(false)
    // El equipo sí lo ve.
    const consola = (await pedir('adm_todo', 'GET', '/api/plataforma/tenants/tn_a/eventos?categoria=seguridad')).cuerpo
    expect(consola.filas.some((e: { eventType: string }) => e.eventType === 'security.cross_tenant_access_attempt')).toBe(true)
  })

  it('el enlace de una invitación no queda en el registro del servidor', () => {
    expect(sinSecretos('<-- POST /api/invitacion/abc123secreto')).toBe('<-- POST /api/invitacion/…')
    expect(sinSecretos('--> GET /invitacion/abc123secreto?x=1 200 3ms')).toBe('--> GET /invitacion/…?x=1 200 3ms')
  })
})
