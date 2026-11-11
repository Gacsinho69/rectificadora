import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { impersonations } from '../soporte/tablas'
import { tenants } from '../tenants/tablas'

const motivo = 'Prueba de la acción con su motivo'

describe('acciones del equipo de la plataforma', () => {
  it('suspender deja el estado, el evento con antes, después, motivo, actor e IP', async () => {
    const { pedir, eventos, base } = await armarPrueba()
    const r = await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/estado', { estado: 'suspended', motivo })
    expect(r.estado).toBe(200)
    const [t] = await base.select().from(tenants).where(eq(tenants.id, 'tn_a'))
    expect(t.status).toBe('suspended')
    const [e] = await eventos('tenant.suspended')
    expect(e).toMatchObject({ tenantId: 'tn_a', actorId: 'adm_todo', actorType: 'platform_admin', ipAddress: '203.0.113.9', userAgent: 'prueba/1.0', targetId: 'tn_a' })
    expect(e.metadata).toEqual({ antes: 'active', despues: 'suspended', motivo })
    // Reactivar es otro evento, también auditado.
    await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/estado', { estado: 'active', motivo })
    expect(await eventos('tenant.reactivated')).toHaveLength(1)
  })

  it('sin el permiso no cambia nada, responde 403 y la negativa queda anotada', async () => {
    const { pedir, eventos, base } = await armarPrueba()
    const r = await pedir('adm_sin', 'POST', '/api/plataforma/tenants/tn_a/plan', { plan: 'enterprise', motivo })
    expect(r.estado).toBe(403)
    const [t] = await base.select().from(tenants).where(eq(tenants.id, 'tn_a'))
    expect(t.plan).toBe('pro')
    const [e] = await eventos('security.permission_denied')
    expect(e).toMatchObject({ tenantId: 'tn_a', actorId: 'adm_sin' })
    expect(e.metadata).toMatchObject({ permiso: 'tenants.plan' })
  })

  it('las acciones sensibles exigen motivo', async () => {
    const { pedir } = await armarPrueba()
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/estado', { estado: 'suspended', motivo: 'corto' })).estado).toBe(400)
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/limites', { ajustes: { users: 50 } })).estado).toBe(400)
  })

  it('cambiar plan y límites guarda el antes y el después', async () => {
    const { pedir, eventos, base } = await armarPrueba()
    await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/plan', { plan: 'enterprise', motivo })
    await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/limites', { ajustes: { users: 500 }, motivo })
    const [t] = await base.select().from(tenants).where(eq(tenants.id, 'tn_a'))
    expect(t).toMatchObject({ plan: 'enterprise', mrr: 249_000, limitsOverride: { users: 500 } })
    const [plan] = await eventos('tenant.plan_changed')
    expect(plan.metadata).toMatchObject({ antes: { plan: 'pro', mrr: 89_000 }, despues: { plan: 'enterprise', mrr: 249_000 } })
    const [limites] = await eventos('tenant.limits_changed')
    expect(limites.metadata).toMatchObject({ antes: {}, despues: { users: 500 } })
  })

  it('bloquear un usuario solo dentro del cliente indicado', async () => {
    const { pedir, eventos } = await armarPrueba()
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/usuarios/us_b_member/bloqueo', { bloqueado: true, motivo })).estado).toBe(404)
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/usuarios/us_a_member/bloqueo', { bloqueado: true, motivo })).estado).toBe(200)
    const [e] = await eventos('user.blocked')
    expect(e).toMatchObject({ tenantId: 'tn_a', userId: 'us_a_member', actorType: 'platform_admin' })
  })

  it('impersonar: registra quién, a qué cliente, como quién, inicio, fin, motivo e IP; lo hecho dentro queda a nombre del equipo', async () => {
    const { pedir, eventos, base } = await armarPrueba()
    const r = await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/impersonar', { usuario: 'us_a_admin', motivo })
    expect(r.estado).toBe(200)
    const cookie = { impersonacion: r.cuerpo.id }

    // Con la impersonación, el panel del cliente A se abre como su administrador, y solo el de A.
    const panel = await pedir('adm_todo', 'GET', '/api/organizacion/usuarios', undefined, cookie)
    expect(panel.estado).toBe(200)
    expect(panel.cuerpo.every((u: { id: string }) => u.id.startsWith('us_a'))).toBe(true)

    await pedir('adm_todo', 'POST', '/api/organizacion/usuarios/us_a_member/bloqueo', { bloqueado: true }, cookie)
    const [bloqueo] = await eventos('user.blocked')
    expect(bloqueo).toMatchObject({ actorId: 'adm_todo', actorType: 'platform_admin', tenantId: 'tn_a' })
    expect(bloqueo.metadata).toMatchObject({ impersonation_id: r.cuerpo.id, impersonated_user_id: 'us_a_admin' })

    expect((await pedir('adm_todo', 'POST', '/api/plataforma/impersonacion/terminar', {}, cookie)).estado).toBe(200)
    const [fila] = await base.select().from(impersonations).where(eq(impersonations.id, r.cuerpo.id))
    expect(fila).toMatchObject({ adminId: 'adm_todo', tenantId: 'tn_a', userId: 'us_a_admin', reason: motivo, adminIp: '203.0.113.9' })
    expect(fila.startedAt).toBeInstanceOf(Date)
    expect(fila.endedAt).toBeInstanceOf(Date)
    expect(await eventos('support.impersonation_started')).toHaveLength(1)
    expect(await eventos('support.impersonation_ended')).toHaveLength(1)

    // Terminada, la cookie ya no sirve.
    expect((await pedir('adm_todo', 'GET', '/api/organizacion/usuarios', undefined, cookie)).estado).toBe(403)
  })

  it('no se impersona sin permiso, si el cliente no lo permite, ni como alguien que no es administrador', async () => {
    const { pedir, base } = await armarPrueba()
    expect((await pedir('adm_sin', 'POST', '/api/plataforma/tenants/tn_a/impersonar', { usuario: 'us_a_admin', motivo })).estado).toBe(403)
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/impersonar', { usuario: 'us_a_member', motivo })).estado).toBe(409)
    await base.update(tenants).set({ supportAccess: false }).where(eq(tenants.id, 'tn_a'))
    expect((await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/impersonar', { usuario: 'us_a_admin', motivo })).estado).toBe(403)
  })

  it('la impersonación de otra persona del equipo no sirve aunque se copie la cookie', async () => {
    const { pedir } = await armarPrueba()
    const r = await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/impersonar', { usuario: 'us_a_admin', motivo })
    expect((await pedir('adm_sin', 'GET', '/api/organizacion/usuarios', undefined, { impersonacion: r.cuerpo.id })).estado).toBe(403)
  })

  it('ver IPs completas pide permiso y queda anotado una vez', async () => {
    const { pedir, eventos } = await armarPrueba()
    expect((await pedir('adm_sin', 'GET', '/api/plataforma/tenants/tn_a/seguridad?completo=1')).estado).toBe(403)
    expect((await pedir('adm_todo', 'GET', '/api/plataforma/tenants/tn_a/seguridad?completo=1')).cuerpo.completo).toBe(true)
    await pedir('adm_todo', 'GET', '/api/plataforma/tenants/tn_a/seguridad?completo=1')
    expect(await eventos('data.sensitive_accessed')).toHaveLength(1)
  })
})
