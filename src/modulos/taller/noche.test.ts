// Lo que se arregló en la revisión del taller: calidad con el diagnóstico pendiente, lo apagado, la cola sin
// especialistas y los que tocan «Iniciar» a la vez.
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { customPieces, services, serviceSpecialists, shopSections, workOrderTasks } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
const servicio = async (p: Prueba, codigo: string) => (await p.base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.code, codigo))))[0]
const recibir = async (p: Prueba, piezas = ['block']) => (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas })).cuerpo.id as string

describe('el estado de la OT', () => {
  it('un armado adelantado y terminado no manda la OT a calidad con el diagnóstico pendiente', async () => {
    const p = await armarPrueba()
    const otId = await recibir(p, ['motor'])
    const armado = await servicio(p, 'A-01')
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/tareas`, { trabajoId: armado.id })).estado).toBe(200)
    const [t] = await p.base.select().from(workOrderTasks).where(and(eq(workOrderTasks.workOrderId, otId), eq(workOrderTasks.serviceId, armado.id)))
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${t.id}/adelantar`)).estado).toBe(200)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${t.id}/terminar`, {})).estado).toBe(200)
    expect((await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.estado).toBe('in_progress')
  })
})

describe('lo apagado no vuelve por otro lado', () => {
  it('una actividad de una sección apagada no se enciende ni entra a una OT', async () => {
    const p = await armarPrueba()
    const pulido = await servicio(p, 'G-01')
    await p.base.update(services).set({ active: false }).where(eq(services.sectionId, pulido.sectionId))
    await p.base.update(shopSections).set({ active: false }).where(eq(shopSections.id, pulido.sectionId))
    const encender = await p.pedir('us_a_admin', 'POST', `/api/servicio/catalogo/${pulido.id}`, { activo: true })
    expect(encender.estado).toBe(409)
    expect(encender.cuerpo.error).toContain('sección está apagada')
    // Aunque quedara encendida por otro camino, no entra a una OT.
    await p.base.update(services).set({ active: true }).where(eq(services.id, pulido.id))
    const otId = await recibir(p)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/tareas`, { trabajoId: pulido.id })).estado).toBe(409)
  })

  it('una actividad de una pieza propia que ya no se usa no entra a una OT', async () => {
    const p = await armarPrueba()
    await p.base.insert(customPieces).values({ id: 'pz_turbo', tenantId: 'tn_a', name: 'Turbo', position: 0, active: false })
    const pulido = await servicio(p, 'G-01')
    await p.base.update(services).set({ piece: 'pz_turbo' }).where(eq(services.id, pulido.id))
    const otId = await recibir(p)
    const r = await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/tareas`, { trabajoId: pulido.id })
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('Turbo')
  })

  it('dos que crean la misma pieza a la vez dejan una sola', async () => {
    const p = await armarPrueba()
    const r = await Promise.all([p.pedir('us_a_admin', 'POST', '/api/servicio/piezas', { nombre: 'Turbo' }), p.pedir('us_a_admin', 'POST', '/api/servicio/piezas', { nombre: 'turbo' })])
    expect(r.map((x) => x.estado).sort()).toEqual([200, 409])
    expect(await p.base.select().from(customPieces).where(eq(customPieces.tenantId, 'tn_a'))).toHaveLength(1)
  })
})

describe('la cola y los que trabajan a la vez', () => {
  it('sin especialistas, la cola igual alarga la entrega sugerida', async () => {
    const p = await armarPrueba()
    await p.base.delete(serviceSpecialists).where(eq(serviceSpecialists.tenantId, 'tn_a'))
    const sugerida = async () => (await p.pedir('us_a_jefe', 'GET', '/api/servicio/entrega-sugerida?piezas=motor')).cuerpo.dias as number
    const vacio = await sugerida()
    for (let i = 0; i < 4; i++) await recibir(p, ['motor'])
    expect(await sugerida()).toBeGreaterThan(vacio)
  })

  it('dos que tocan «Iniciar» a la vez: uno lo toma y el otro sabe que ya se inició', async () => {
    const p = await armarPrueba()
    const otId = await recibir(p)
    const [t] = await p.base.select().from(workOrderTasks).where(eq(workOrderTasks.workOrderId, otId)).orderBy(workOrderTasks.step)
    await p.base.update(workOrderTasks).set({ assignedTo: null }).where(eq(workOrderTasks.id, t.id))
    const r = await Promise.all([p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${t.id}/iniciar`), p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${t.id}/iniciar`)])
    expect(r.map((x) => x.estado).sort()).toEqual([200, 409])
    const [despues] = await p.base.select().from(workOrderTasks).where(eq(workOrderTasks.id, t.id))
    const quien = r[0].estado === 200 ? 'us_a_member' : 'us_a_jefe'
    expect(despues.assignedTo).toBe(quien)
  })
})
