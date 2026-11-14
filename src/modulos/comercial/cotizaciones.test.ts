import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { services, workOrders } from '../taller/tablas'
import { customers } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>

async function lineaDeCulata(p: Prueba) {
  const [t] = await p.base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.code, 'C-01')))
  return { tipo: 'trabajo', trabajoId: t.id, seccionId: t.sectionId, codigo: t.code, descripcion: t.name, cantidad: 1, precio: t.price, horas: t.stdHours }
}

describe('las cotizaciones', () => {
  it('aceptar dos veces a la vez (un doble clic) deja una sola OT', async () => {
    const p = await armarPrueba()
    const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', motor: 'Cummins ISX15', lineas: [await lineaDeCulata(p)] })).cuerpo
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
    const [a, b] = await Promise.all([p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {}), p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})])
    expect([a.estado, b.estado].sort()).toEqual([200, 409])
    expect(await p.base.select().from(workOrders).where(eq(workOrders.tenantId, 'tn_a'))).toHaveLength(1)
    expect(await p.eventos('quote.accepted')).toHaveLength(1)
  })

  it('no se cotiza sobre la OT de otro cliente ni sobre una OT anulada', async () => {
    const p = await armarPrueba()
    await p.base.insert(customers).values({ id: 'cl_a2', tenantId: 'tn_a', name: 'Áridos del Norte' })
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a2', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo
    const lineas = [await lineaDeCulata(p)]
    const ajena = await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: 'Cummins ISX15', lineas })
    expect(ajena.estado).toBe(409)
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/anular`, { motivo: 'El cliente se lo llevó' })
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a2', otId, motor: 'Cummins ISX15', lineas })).estado).toBe(409)
  })

  it('el RUT del cliente se revisa y se guarda con su formato', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/clientes', { nombre: 'Transportes Sur', rut: '76.412.893-5' })).estado).toBe(400)
    const { id } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/clientes', { nombre: 'Transportes Sur', rut: '764128931' })).cuerpo
    const [c] = await p.base.select().from(customers).where(eq(customers.id, id))
    expect(c.taxId).toBe('76.412.893-1')
    // Se encuentra igual escrito sin puntos.
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/clientes?q=76412893')).cuerpo.map((x: { id: string }) => x.id)).toEqual([id])
  })

  it('un borrador ligado a una OT que después se anuló se puede seguir corrigiendo', async () => {
    const p = await armarPrueba()
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo
    const datos = { clienteId: 'cl_a', otId, motor: 'Cummins ISX15', lineas: [await lineaDeCulata(p)] }
    const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', datos)).cuerpo
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/anular`, { motivo: 'El cliente se lo llevó' })
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}`, { ...datos, notas: 'Corregido' })).estado).toBe(200)
    // Pero no se acepta: la OT ya no está en el taller.
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})).estado).toBe(409)
  })
})
