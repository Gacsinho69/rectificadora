import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { comparacionDeCostos, margenDe } from './reglas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>

/** Un motor con un kit de pistones cotizado a $420.000 (costo $300.000), aceptado y pedido en una orden de compra. */
async function pistonesPedidos(p: Prueba) {
  const proveedor = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/proveedores', { nombre: 'Repuestos Diesel Sur' })).cuerpo.id
  const linea = { tipo: 'repuesto', trabajoId: null, seccionId: null, codigo: null, descripcion: 'Kit de pistones', cantidad: 2, horas: 0, precio: 420_000, compra: 'shop', proveedorId: proveedor, costo: 300_000 }
  const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', motor: 'Cummins ISX15', lineas: [linea] })).cuerpo
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
  const { otId } = (await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})).cuerpo
  const [kit] = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo.porPedir
  const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: [kit.id], proveedorId: proveedor })).cuerpo
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})
  return { otId: otId as string, ocId: oc.id as string, kit: kit.id as string }
}

describe('el costo real contra lo cotizado', () => {
  it('se anota con la factura; compras lo compara por proveedor y la OT dice lo que dejaron sus repuestos', async () => {
    const p = await armarPrueba()
    const { otId, ocId, kit } = await pistonesPedidos(p)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/compras/ordenes/${ocId}/costos`, { repuestos: [{ id: kit, costo: 1 }] })).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${ocId}/costos`, { factura: 'F-4521', repuestos: [{ id: kit, costo: 330_000 }] })).estado).toBe(200)

    const [orden] = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo.ordenes
    expect(orden).toMatchObject({ factura: 'F-4521', costo: 600_000, costoReal: 660_000, repuestos: [{ costo: 300_000, costoReal: 330_000 }] })
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras/costos')).cuerpo.proveedores).toEqual([
      { proveedor: 'Repuestos Diesel Sur', lineas: 1, porAnotar: 0, cotizado: 600_000, real: 660_000, diferencia: 60_000, fraccion: 0.1 },
    ])
    expect((await p.pedir('us_a_member', 'GET', '/api/servicio/compras/costos')).estado).toBe(403)

    // La OT: lo cobrado al cliente y lo que costó, para quien ve montos.
    const repuestoDe = async (quien: string) => ((await p.pedir(quien, 'GET', `/api/servicio/ot/${otId}`)).cuerpo.repuestos as { precio: number | null; costoReal: number | null }[])[0]
    expect(await repuestoDe('us_a_jefe')).toMatchObject({ precio: 420_000, costoReal: 330_000 })
    expect(await repuestoDe('us_a_member')).toMatchObject({ precio: null, costoReal: null })
  })

  it('el costo real de un insumo queda como su costo de ahora en adelante', async () => {
    const p = await armarPrueba()
    const proveedor = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/proveedores', { nombre: 'Lubricantes del Sur' })).cuerpo.id
    const aceite = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/insumos', { nombre: 'Aceite de prueba', unidad: 'litro', minimo: 10, costo: 4_500 })).cuerpo.id
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: aceite, cantidad: 20 }], proveedorId: proveedor })).cuerpo
    const [orden] = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo.ordenes
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/costos`, { insumos: [{ id: orden.insumos[0].id, costo: 4_900 }] })
    const [insumo] = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/insumos')).cuerpo
    expect(insumo.costo).toBe(4_900)
  })

  it('aislamiento: otra rectificadora no anota costos en órdenes ni repuestos ajenos', async () => {
    const p = await armarPrueba()
    const { ocId, kit } = await pistonesPedidos(p)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/compras/ordenes/${ocId}/costos`, { factura: 'Mía' })).estado).toBe(404)
    // Con una orden propia, tampoco puede nombrar un repuesto de A.
    const deB = (await p.pedir('us_b_admin', 'POST', '/api/servicio/proveedores', { nombre: 'Proveedor de B' })).cuerpo.id
    const insumoB = (await p.pedir('us_b_admin', 'POST', '/api/servicio/insumos', { nombre: 'Guaipe', unidad: 'kilo' })).cuerpo.id
    const ocB = (await p.pedir('us_b_admin', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: insumoB, cantidad: 1 }], proveedorId: deB })).cuerpo.id
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/compras/ordenes/${ocB}/costos`, { repuestos: [{ id: kit, costo: 1 }] })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(2)
    const [orden] = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo.ordenes
    expect(orden).toMatchObject({ factura: null, repuestos: [{ costoReal: null }] })
  })

  it('las cuentas: la diferencia por proveedor y el margen', () => {
    expect(comparacionDeCostos([
      { proveedor: 'Sur', cantidad: 2, costo: 100, costoReal: 120 },
      { proveedor: 'Sur', cantidad: 1, costo: 50, costoReal: null },
      { proveedor: 'Casa', cantidad: 1, costo: 200, costoReal: 180 },
    ])).toEqual([
      { proveedor: 'Sur', lineas: 2, porAnotar: 1, cotizado: 200, real: 240, diferencia: 40, fraccion: 0.2 },
      { proveedor: 'Casa', lineas: 1, porAnotar: 0, cotizado: 200, real: 180, diferencia: -20, fraccion: -0.1 },
    ])
    expect(margenDe(1000, 750)).toBe(0.25)
    expect(margenDe(0, 100)).toBeNull()
  })
})
