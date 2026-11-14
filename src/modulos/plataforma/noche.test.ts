// Lo que se arregló en la revisión de la consola: el cobro sigue al estado y al plan, las IPs tapadas, el uso con
// límite cero y el almacenamiento de quien dejó de entrar, y el filtro por día de creación.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { registrar } from '../eventos/registrar'
import { PLANES } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import { usageDaily } from '../uso/tablas'
import { unMesDespues } from './acciones'
import { panorama } from './panorama'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
const motivo = 'Prueba de la acción con su motivo'
const tenantA = async (p: Prueba) => (await p.base.select().from(tenants).where(eq(tenants.id, 'tn_a')))[0]
const estado = (p: Prueba, estado: string) => p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/estado', { estado, motivo })

describe('el cobro sigue al estado y al plan', () => {
  it('de prueba a suspendido y después a activo: igual empieza a pagar', async () => {
    const p = await armarPrueba()
    await p.base.update(tenants).set({ status: 'trial', mrr: 0, billingStatus: 'none', nextBillingAt: null, trialEndsAt: p.ahora }).where(eq(tenants.id, 'tn_a'))
    expect((await estado(p, 'suspended')).estado).toBe(200)
    expect((await estado(p, 'active')).estado).toBe(200)
    expect(await tenantA(p)).toMatchObject({ status: 'active', mrr: PLANES.pro.precio, billingStatus: 'paid' })
  })

  it('cancelar deja de cobrar; si vuelve, vuelve a cobrarse lo que pagaba', async () => {
    const p = await armarPrueba()
    await p.base.update(tenants).set({ billingStatus: 'failed' }).where(eq(tenants.id, 'tn_a'))
    await estado(p, 'cancelled')
    expect(await tenantA(p)).toMatchObject({ status: 'cancelled', billingStatus: 'cancelled', nextBillingAt: null })
    expect((await p.pedir('adm_todo', 'GET', '/api/plataforma/resumen')).cuerpo.pagos.fallidos).toBe(0)
    await estado(p, 'active')
    const t = await tenantA(p)
    expect(t).toMatchObject({ status: 'active', mrr: 89_000, billingStatus: 'paid' })
    expect(t.nextBillingAt).not.toBeNull()
  })

  it('de gratis a pagado empieza a cobrarse; de pagado a gratis deja de cobrarse', async () => {
    const p = await armarPrueba()
    await p.base.update(tenants).set({ plan: 'free', mrr: 0, billingStatus: 'none', nextBillingAt: null }).where(eq(tenants.id, 'tn_a'))
    await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/plan', { plan: 'starter', motivo })
    let t = await tenantA(p)
    expect(t).toMatchObject({ mrr: PLANES.starter.precio, billingStatus: 'paid' })
    expect(t.nextBillingAt).not.toBeNull()
    await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/plan', { plan: 'free', motivo })
    t = await tenantA(p)
    expect(t).toMatchObject({ mrr: 0, billingStatus: 'none', nextBillingAt: null })
  })

  it('el próximo cobro del 31 de enero es el 28 de febrero', () => {
    expect(unMesDespues(new Date('2026-01-31T15:00:00Z')).toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(unMesDespues(new Date('2026-11-11T15:00:00Z')).toISOString().slice(0, 10)).toBe('2026-12-11')
  })
})

describe('las IPs sin pedir lo completo', () => {
  it('el resumen, la actividad y la seguridad de un cliente tapan la IP', async () => {
    const p = await armarPrueba()
    const origen = { actorId: 'us_a_admin', actorType: 'user' as const, ipAddress: '190.45.12.34', userAgent: null }
    await registrar(p.base, origen, { tenantId: 'tn_a', eventType: 'system.error', metadata: { mensaje: 'falló' } })
    await registrar(p.base, origen, { tenantId: 'tn_a', eventType: 'work_order.created', metadata: { numero: 1 } })
    await registrar(p.base, origen, { tenantId: 'tn_a', eventType: 'user.role_changed', userId: 'us_a_member', metadata: { antes: 'technician', despues: 'planner' } })
    const todo = JSON.stringify([
      (await p.pedir('adm_sin', 'GET', '/api/plataforma/resumen')).cuerpo,
      (await p.pedir('adm_sin', 'GET', '/api/plataforma/tenants/tn_a/actividad')).cuerpo,
      (await p.pedir('adm_sin', 'GET', '/api/plataforma/tenants/tn_a/seguridad')).cuerpo,
    ])
    expect(todo).not.toContain('190.45.12.34')
  })

  it('la auditoría de una función guarda antes y después', async () => {
    const p = await armarPrueba()
    await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/funciones', { funcion: 'supplies', activa: false, motivo })
    const [e] = await p.eventos('tenant.feature_flag_changed')
    expect(e.metadata).toMatchObject({ funcion: 'supplies', antes: true, despues: false })
  })
})

describe('el uso y la lista de clientes', () => {
  it('un límite en cero con algo usado está excedido, y el almacenamiento de quien dejó de entrar no es cero', async () => {
    const p = await armarPrueba()
    await p.base.update(tenants).set({ limitsOverride: { work_orders_month: 0 } }).where(eq(tenants.id, 'tn_a'))
    await p.base.insert(usageDaily).values([
      { tenantId: 'tn_a', day: '2026-11-10', workOrders: 3 },
      { tenantId: 'tn_b', day: '2026-09-20', storageMb: 9_000 },
    ])
    const [a, b] = await panorama(p.base, p.ahora).then((l) => ['tn_a', 'tn_b'].map((id) => l.find((t) => t.id === id)!))
    expect(a.usos.find((u) => u.clave === 'work_orders_month')!.fraccion).toBe(1)
    expect(b.usos.find((u) => u.clave === 'storage_mb')!.usado).toBe(9_000)
  })

  it('el filtro por día de creación usa el día de Chile, el mismo de la columna', async () => {
    const p = await armarPrueba()
    // 22:30 del 14 de noviembre en Chile.
    await p.base.update(tenants).set({ createdAt: new Date('2026-11-15T01:30:00Z') }).where(eq(tenants.id, 'tn_a'))
    const ids = (await p.pedir('adm_todo', 'GET', '/api/plataforma/tenants?creadoDesde=2026-11-14&creadoHasta=2026-11-14')).cuerpo.filas.map((t: { id: string }) => t.id)
    expect(ids).toEqual(['tn_a'])
  })
})
