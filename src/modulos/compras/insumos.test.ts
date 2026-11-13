import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type Insumo = { id: string; nombre: string; stock: number; porLlegar: number; bajo: boolean; costo: number | null; proveedor: string | null; movimientos: { tipo: string; cantidad: number; ot: number | null; quien: string | null }[] }

const insumos = async (p: Prueba, quien = 'us_a_jefe') => (await p.pedir(quien, 'GET', '/api/servicio/insumos')).cuerpo as Insumo[]
const compras = async (p: Prueba, quien = 'us_a_jefe') => (await p.pedir(quien, 'GET', '/api/servicio/compras')).cuerpo

describe('la bodega de insumos', () => {
  it('lo que queda en su mínimo se pide en la orden de compra, entra a bodega al recibirse y sale con su movimiento', async () => {
    const p = await armarPrueba()
    const proveedor = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/proveedores', { nombre: 'Lubricantes del Sur' })).cuerpo.id
    expect((await p.pedir('us_a_member', 'POST', '/api/servicio/insumos', { nombre: 'Aceite de prueba', unidad: 'litro' })).estado).toBe(403)
    const aceite = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/insumos', { nombre: 'Aceite de prueba', unidad: 'litro', minimo: 10, proveedorId: proveedor, costo: 4_500 })).cuerpo.id

    // Sin stock, está en su mínimo: aparece para pedir, con lo que conviene (el doble del mínimo).
    let c = await compras(p)
    expect(c.insumosBajos).toMatchObject([{ id: aceite, nombre: 'Aceite de prueba', stock: 0, minimo: 10, sugerido: 20, proveedorId: proveedor, costo: 4_500 }])
    expect((await compras(p, 'us_a_member')).insumosBajos[0]).toMatchObject({ proveedor: null, costo: null })

    // Una orden solo de insumos, con el chofer.
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { proveedorId: proveedor })).cuerpo.error).toBe('Elige qué pedir.')
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: aceite, cantidad: 20 }], proveedorId: proveedor, choferId: 'us_a_member' })).cuerpo
    c = await compras(p)
    expect(c.insumosBajos).toEqual([])
    expect(c.ordenes[0]).toMatchObject({ numero: oc.numero, costo: 90_000, insumos: [{ insumoId: aceite, nombre: 'Aceite de prueba', unidad: 'litro', cantidad: 20, estado: 'ordered' }] })
    expect((await insumos(p))[0]).toMatchObject({ stock: 0, porLlegar: 20 })
    const inicio = (await p.pedir('us_a_member', 'GET', '/api/servicio/inicio')).cuerpo
    expect(inicio.misRetiros[0].repuestos).toEqual([{ descripcion: 'Aceite de prueba (litro)', medida: null, cantidad: 20, ot: null }])

    // El chofer la recibe: entra a bodega como compra y la orden queda recibida.
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})).cuerpo).toMatchObject({ estado: 'received', recibidos: 1 })
    expect((await insumos(p))[0]).toMatchObject({ stock: 20, porLlegar: 0, bajo: false, movimientos: [{ tipo: 'purchase', cantidad: 20, quien: 'us_a_member' }] })

    // El técnico saca lo que usa para una OT; no más de lo que hay. El de solo lectura no saca.
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo
    expect((await p.pedir('us_a_lector', 'POST', `/api/servicio/insumos/${aceite}/sacar`, { cantidad: 1 })).estado).toBe(403)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/insumos/${aceite}/sacar`, { cantidad: 12, otId })).cuerpo).toMatchObject({ ok: true, stock: 8 })
    const demasiado = await p.pedir('us_a_member', 'POST', `/api/servicio/insumos/${aceite}/sacar`, { cantidad: 9 })
    expect(demasiado.estado).toBe(409)
    expect(demasiado.cuerpo.error).toContain('Solo quedan 8 litro')
    // Quedó bajo su mínimo: vuelve a aparecer para pedir.
    expect((await compras(p)).insumosBajos).toMatchObject([{ id: aceite, stock: 8, sugerido: 12 }])

    // El jefe ajusta al conteo, con su motivo; el técnico no.
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/insumos/${aceite}/ajustar`, { stock: 7, nota: 'Conteo' })).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/insumos/${aceite}/ajustar`, { stock: 7 })).estado).toBe(400)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/insumos/${aceite}/ajustar`, { stock: 7, nota: 'Conteo de fin de mes' })).estado).toBe(200)
    // En la prueba los tres llevan la misma hora: se comparan sin orden.
    const movimientos = (await insumos(p))[0].movimientos.map((m) => [m.tipo, m.cantidad, m.ot])
    expect(movimientos).toHaveLength(3)
    expect(movimientos).toEqual(expect.arrayContaining([['adjust', -1, null], ['use', -12, 1], ['purchase', 20, null]]))
  })

  it('una orden con repuestos e insumos: se reciben por partes y no se anula si ya llegó algo', async () => {
    const p = await armarPrueba()
    const proveedor = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/proveedores', { nombre: 'Casa del Repuesto' })).cuerpo.id
    const pasta = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/insumos', { nombre: 'Pasta de esmeril', unidad: 'tarro', minimo: 2 })).cuerpo.id
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['motor'] })).cuerpo
    const rep = (await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Bomba de agua', proveedorId: proveedor })).cuerpo.id
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: [rep], insumos: [{ insumoId: pasta, cantidad: 4 }], proveedorId: proveedor })).cuerpo
    const [orden] = (await compras(p)).ordenes
    // La orden para imprimir: lo pedido con su referencia, sin el cliente ni la OT. El técnico y otra rectificadora no la ven.
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/insumos/${pasta}`, { nombre: 'Pasta de esmeril', unidad: 'tarro', minimo: 2, marca: 'Permatex' })
    const impresa = await p.pedir('us_a_jefe', 'GET', `/api/servicio/compras/ordenes/${oc.id}`)
    expect(impresa.cuerpo).toMatchObject({ numero: 1, proveedor: { nombre: 'Casa del Repuesto' }, pedidoPor: 'us_a_jefe', neto: 0 })
    expect(impresa.cuerpo.lineas).toEqual([
      { descripcion: 'Bomba de agua', medida: null, marca: null, codigo: null, cantidad: 1, unidad: null, costo: null },
      { descripcion: 'Pasta de esmeril', medida: null, marca: 'Permatex', codigo: null, cantidad: 4, unidad: 'tarro', costo: null },
    ])
    expect(JSON.stringify(impresa.cuerpo)).not.toContain('Transportes')
    expect((await p.pedir('us_a_member', 'GET', `/api/servicio/compras/ordenes/${oc.id}`)).estado).toBe(403)
    expect((await p.pedir('us_b_admin', 'GET', `/api/servicio/compras/ordenes/${oc.id}`)).estado).toBe(404)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, { insumos: [orden.insumos[0].id] })).cuerpo).toMatchObject({ estado: 'open', recibidos: 1 })
    expect((await insumos(p))[0].stock).toBe(4)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/anular`, { motivo: 'Ya no' })).estado).toBe(409)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, { repuestos: [rep] })).cuerpo).toMatchObject({ estado: 'received', recibidos: 1 })
  })

  it('aislamiento: otra rectificadora no ve, no saca ni pide insumos ajenos, y cada intento queda anotado', async () => {
    const p = await armarPrueba()
    const aceite = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/insumos', { nombre: 'Aceite de prueba', unidad: 'litro', minimo: 10 })).cuerpo.id
    const deB = (await p.pedir('us_b_admin', 'POST', '/api/servicio/proveedores', { nombre: 'Proveedor de B' })).cuerpo.id
    expect(await insumos(p, 'us_b_admin')).toEqual([])
    expect((await compras(p, 'us_b_admin')).insumosBajos).toEqual([])
    expect((await p.pedir('us_b_member', 'POST', `/api/servicio/insumos/${aceite}/sacar`, { cantidad: 1 })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/insumos/${aceite}/ajustar`, { stock: 50, nota: 'Mío' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/insumos/${aceite}`, { nombre: 'Mío', unidad: 'litro' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: aceite, cantidad: 5 }], proveedorId: deB })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(4)
    expect((await insumos(p))[0]).toMatchObject({ nombre: 'Aceite de prueba', stock: 0, porLlegar: 0 })
  })
})
