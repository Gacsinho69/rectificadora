import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { tenants } from '../tenants/tablas'
import { usageDaily } from '../uso/tablas'
import { services } from './tablas'

const recepcion = { clienteId: 'cl_a', motor: 'Mercedes-Benz OM 457', piezas: ['motor'], falla: 'Golpe de biela', entrega: '2026-11-20' }

async function trabajoDe(base: Awaited<ReturnType<typeof armarPrueba>>['base'], codigo: string) {
  const [t] = await base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.code, codigo)))
  return t
}

describe('el sistema de la rectificadora', () => {
  it('recibe un motor: OT correlativa con su diagnóstico, evento y uso para la consola', async () => {
    const { pedir, eventos, base } = await armarPrueba()
    const r = await pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)
    expect(r.cuerpo).toMatchObject({ numero: 1 })
    expect((await pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo.numero).toBe(2)
    const ot = (await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${r.cuerpo.id}`)).cuerpo
    expect(ot.estado).toBe('received')
    expect(ot.tareas.map((t: { nombre: string }) => t.nombre)).toEqual(['Desarme y lavado de motor', 'Medición y metrología (informe)'])
    expect(await eventos('work_order.created')).toHaveLength(2)
    const [uso] = await base.select().from(usageDaily).where(eq(usageDaily.tenantId, 'tn_a'))
    expect(uso.workOrders).toBe(2)
    expect(uso.apiCalls).toBeGreaterThanOrEqual(3)
  })

  it('el recorrido completo: diagnóstico, cotización, aprobación, secciones, calidad y entrega', async () => {
    const { pedir, base, eventos } = await armarPrueba()
    const { id: otId } = (await pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo
    const diag = (await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas
    await pedir('us_a_member', 'POST', `/api/servicio/tareas/${diag[0].id}/iniciar`)
    expect((await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.estado).toBe('diagnosis')
    for (const t of diag) await pedir('us_a_member', 'POST', `/api/servicio/tareas/${t.id}/terminar`)

    const culata = await trabajoDe(base, 'C-01')
    const cigueñal = await trabajoDe(base, 'G-01')
    const linea = (t: typeof culata) => ({ tipo: 'trabajo', trabajoId: t.id, seccionId: t.sectionId, codigo: t.code, descripcion: t.name, cantidad: 1, precio: t.price, horas: t.stdHours })
    const lineas = [linea(culata), linea(cigueñal), { tipo: 'repuesto', trabajoId: null, seccionId: null, codigo: null, descripcion: 'Juego de metales', cantidad: 1, precio: 180_000, horas: 0 }]
    const cot = (await pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: recepcion.motor, lineas, descuento: 10 })).cuerpo
    expect(cot.numero).toBe(1)
    const detalle = (await pedir('us_a_jefe', 'GET', `/api/servicio/cotizaciones/${cot.id}`)).cuerpo
    const neto = Math.round((culata.price! + cigueñal.price! + 180_000) * 0.9)
    expect(detalle).toMatchObject({ estado: 'draft', neto, iva: Math.round(neto * 0.19) })

    await pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
    expect((await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.estado).toBe('waiting_approval')
    await pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})
    const enTaller = (await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo
    expect(enTaller.estado).toBe('in_progress')
    // Los trabajos cotizados quedan en su sección; el repuesto no es trabajo del taller.
    expect(enTaller.tareas.filter((t: { diagnostico: boolean }) => !t.diagnostico).map((t: { seccion: string }) => t.seccion)).toEqual(['Culatas', 'Cigüeñal y bielas'])

    const tablero = (await pedir('us_a_member', 'GET', '/api/servicio/taller')).cuerpo
    expect(tablero.secciones.find((s: { nombre: string }) => s.nombre === 'Culatas').tareas).toHaveLength(1)

    for (const t of enTaller.tareas.filter((t: { diagnostico: boolean }) => !t.diagnostico)) {
      await pedir('us_a_member', 'POST', `/api/servicio/tareas/${t.id}/iniciar`)
      await pedir('us_a_member', 'POST', `/api/servicio/tareas/${t.id}/terminar`)
    }
    expect((await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo).toMatchObject({ estado: 'quality', avance: 1 })
    expect((await pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/entregar`, { recibe: 'Pedro' })).estado).toBe(409)
    await pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/calidad`)
    expect((await pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/entregar`, { recibe: 'Pedro Gallardo' })).estado).toBe(200)
    expect((await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo).toMatchObject({ estado: 'delivered', entregadaA: 'Pedro Gallardo' })
    expect(await eventos('work_order.closed')).toHaveLength(1)
    expect(await eventos('quote.accepted')).toHaveLength(1)
  })

  it('aceptar una cotización sin OT crea la OT con sus trabajos', async () => {
    const { pedir, base } = await armarPrueba()
    const t = await trabajoDe(base, 'G-01')
    const cot = (await pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', motor: 'Cummins ISX15', lineas: [{ tipo: 'trabajo', trabajoId: t.id, seccionId: t.sectionId, codigo: t.code, descripcion: t.name, cantidad: 1, precio: t.price, horas: t.stdHours }] })).cuerpo
    await pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
    const { otId } = (await pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})).cuerpo
    const ot = (await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo
    expect(ot).toMatchObject({ numero: 1, estado: 'in_progress', motor: 'Cummins ISX15' })
  })

  it('no se envía una cotización con un trabajo de terceros sin precio', async () => {
    const { pedir, base } = await armarPrueba()
    const t = await trabajoDe(base, 'T-02')
    const cot = (await pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', motor: 'Cummins ISX15', lineas: [{ tipo: 'trabajo', trabajoId: t.id, seccionId: t.sectionId, codigo: t.code, descripcion: t.name, cantidad: 1, precio: null, horas: 0 }] })).cuerpo
    const r = await pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('Nitrurado')
  })

  it('cada rol hace lo suyo: el técnico no ve montos ni recibe; solo lectura no trabaja', async () => {
    const { pedir } = await armarPrueba()
    expect((await pedir('us_a_member', 'POST', '/api/servicio/ot', recepcion)).estado).toBe(403)
    expect((await pedir('us_a_member', 'GET', '/api/servicio/cotizaciones')).estado).toBe(403)
    expect((await pedir('us_a_member', 'GET', '/api/servicio/inicio')).cuerpo.comercial).toBeNull()
    const { id } = (await pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo
    const [t] = (await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${id}`)).cuerpo.tareas
    expect((await pedir('us_a_lector', 'POST', `/api/servicio/tareas/${t.id}/iniciar`)).estado).toBe(403)
    expect((await pedir('us_a_lector', 'GET', '/api/servicio/ot')).estado).toBe(200)
  })

  it('aislamiento: otro cliente no ve ni toca las OT, y abrir el portal ajeno queda anotado', async () => {
    const { pedir, eventos } = await armarPrueba()
    const { id } = (await pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo
    expect((await pedir('us_b_admin', 'GET', '/api/servicio/ot')).cuerpo.total).toBe(0)
    expect((await pedir('us_b_admin', 'GET', `/api/servicio/ot/${id}`)).estado).toBe(404)
    expect((await pedir('us_b_admin', 'POST', `/api/servicio/ot/${id}/anular`, { motivo: 'probando ids' })).estado).toBe(404)
    // Recibir un motor para un cliente de la otra rectificadora tampoco.
    expect((await pedir('us_b_admin', 'POST', '/api/servicio/ot', { ...recepcion })).estado).toBe(404)
    expect((await pedir('us_b_admin', 'GET', '/api/servicio/inicio', undefined, {}, { 'x-portal': 'tn_a' })).estado).toBe(403)
    expect(await eventos('security.cross_tenant_access_attempt')).toHaveLength(4)
  })

  it('el límite de OT del plan se respeta', async () => {
    const { pedir, base } = await armarPrueba()
    await base.update(tenants).set({ limitsOverride: { work_orders_month: 1 } }).where(eq(tenants.id, 'tn_a'))
    expect((await pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).estado).toBe(200)
    const r = await pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('límite')
  })

  it('soporte entra al sistema del cliente solo impersonando, y lo que hace queda a su nombre', async () => {
    const { pedir, eventos } = await armarPrueba()
    expect((await pedir('adm_todo', 'GET', '/api/servicio/inicio')).estado).toBe(403)
    const imp = (await pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/impersonar', { usuario: 'us_a_admin', motivo: 'Ayudar a recibir el primer motor' })).cuerpo
    const r = await pedir('adm_todo', 'POST', '/api/servicio/ot', recepcion, { impersonacion: imp.id })
    expect(r.estado).toBe(200)
    const [e] = await eventos('work_order.created')
    expect(e).toMatchObject({ actorId: 'adm_todo', actorType: 'platform_admin', tenantId: 'tn_a' })
  })
})
