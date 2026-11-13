import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { candidatosDeBodega } from './reglas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>

/** Un kit de pistones guardado en bodega (3 juegos, a $280.000) y una OT con un repuesto igual por pedir. */
async function kitGuardadoYPedido(p: Prueba, cantidad = 2) {
  const kit = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/insumos', { tipo: 'part', nombre: 'Kit de pistones STD', unidad: 'juego', minimo: 1, costo: 280_000, codigo: '228-0001' })).cuerpo.id
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/insumos/${kit}/ajustar`, { stock: 3, nota: 'Inventario inicial' })
  const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Hino J08E', piezas: ['motor'] })).cuerpo
  const rep = (await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Kit de pistones', cantidad, codigo: '228-0001' })).cuerpo.id
  return { kit: kit as string, otId: otId as string, rep: rep as string }
}

describe('repuestos guardados en bodega', () => {
  it('un repuesto por pedir se saca de bodega: queda recibido con el costo de bodega y el trabajo sigue', async () => {
    const p = await armarPrueba()
    const { kit, otId, rep } = await kitGuardadoYPedido(p)
    const ot = async () => (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo
    expect((await ot()).tareas.some((t: { faltan: string[] }) => t.faltan.includes('Kit de pistones'))).toBe(true)

    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/repuestos/${rep}/de-bodega`, { insumoId: kit })).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/repuestos/${rep}/de-bodega`, { insumoId: kit })).estado).toBe(200)
    const despues = await ot()
    expect(despues.repuestos[0]).toMatchObject({ estado: 'received', deBodega: true, costoReal: 280_000 })
    expect(despues.tareas.every((t: { faltan: string[] }) => !t.faltan.length)).toBe(true)
    expect(despues.historia.map((h: { que: string }) => h.que)).toContain('Sacado de bodega: Kit de pistones')
    const [articulo] = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/insumos')).cuerpo
    expect(articulo).toMatchObject({ tipo: 'part', stock: 1 })
    expect(articulo.movimientos).toContainEqual(expect.objectContaining({ tipo: 'use', cantidad: -2, ot: 1 }))
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo.porPedir).toEqual([])

    // Otro igual ya no alcanza.
    const otro = (await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Kit de pistones', cantidad: 2 })).cuerpo.id
    const falta = await p.pedir('us_a_jefe', 'POST', `/api/servicio/repuestos/${otro}/de-bodega`, { insumoId: kit })
    expect(falta.estado).toBe(409)
    expect(falta.cuerpo.error).toContain('En bodega hay 1 juego')
  })

  it('no se saca de bodega lo ya pedido al proveedor, ni sin bodega encendida', async () => {
    const p = await armarPrueba()
    const { kit, rep } = await kitGuardadoYPedido(p, 1)
    const proveedor = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/proveedores', { nombre: 'Repuestos Diesel Sur' })).cuerpo.id
    await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: [rep], proveedorId: proveedor })
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/repuestos/${rep}/de-bodega`, { insumoId: kit })).estado).toBe(409)
    await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/funciones', { funcion: 'supplies', activa: false, motivo: 'Bajó de plan' })
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/repuestos/${rep}/de-bodega`, { insumoId: kit })).estado).toBe(403)
  })

  it('aislamiento: no se saca de la bodega de otra rectificadora, ni para un repuesto ajeno', async () => {
    const p = await armarPrueba()
    const { kit, rep } = await kitGuardadoYPedido(p, 1)
    const { id: otB } = (await p.pedir('us_b_admin', 'POST', '/api/servicio/ot', { clienteId: 'cl_b', motor: 'Hino J08E', piezas: ['motor'] })).cuerpo
    const repB = (await p.pedir('us_b_admin', 'POST', `/api/servicio/ot/${otB}/repuestos`, { descripcion: 'Kit de pistones' })).cuerpo.id
    const kitB = (await p.pedir('us_b_admin', 'POST', '/api/servicio/insumos', { tipo: 'part', nombre: 'Kit B', unidad: 'juego' })).cuerpo.id
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/repuestos/${repB}/de-bodega`, { insumoId: kit })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/repuestos/${rep}/de-bodega`, { insumoId: kitB })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(2)
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/insumos')).cuerpo[0].stock).toBe(3)
  })

  it('los candidatos: los que alcanzan, el mismo número de parte o un nombre parecido primero', () => {
    const a = (nombre: string, stock: number, codigo: string | null = null, tipo: 'part' | 'supply' = 'part') => ({ nombre, codigo, stock, tipo, activo: true })
    const lista = candidatosDeBodega([a('Guaipe', 50, null, 'supply'), a('Empaquetaduras OM 457', 2), a('Kit STD', 1, '228-0001'), a('Kit de pistones Hino', 2), a('Kit vacío', 0)], { descripcion: 'Kit de pistones', codigo: '228-0001', cantidad: 1 })
    expect(lista.map((x) => [x.nombre, x.parecido])).toEqual([
      ['Kit STD', true],
      ['Kit de pistones Hino', true],
      ['Empaquetaduras OM 457', false],
    ])
  })
})
