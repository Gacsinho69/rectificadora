// Lo que pasa cuando dos personas (o un doble clic) hacen lo mismo a la vez: la bodega no se descuadra.
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { candidatosDeBodega } from './reglas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>

async function aceiteConOrden(p: Prueba) {
  const proveedor = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/proveedores', { nombre: 'Lubricantes del Sur' })).cuerpo.id
  const aceite = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/insumos', { nombre: 'Aceite de prueba', unidad: 'litro', minimo: 10, proveedorId: proveedor, costo: 4_500 })).cuerpo.id
  const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: aceite, cantidad: 20 }], proveedorId: proveedor })).cuerpo
  return { aceite, oc }
}
const stockDe = async (p: Prueba, id: string) => ((await p.pedir('us_a_jefe', 'GET', '/api/servicio/insumos')).cuerpo as { id: string; stock: number }[]).find((s) => s.id === id)!.stock

describe('la bodega con dos a la vez', () => {
  it('recibir la misma orden dos veces a la vez la entra una sola vez', async () => {
    const p = await armarPrueba()
    const { aceite, oc } = await aceiteConOrden(p)
    const r = await Promise.all([p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {}), p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})])
    expect(r.map((x) => x.estado).sort()).toEqual([200, 409])
    expect(await stockDe(p, aceite)).toBe(20)
  })

  it('sacar a la vez más de lo que hay no deja la bodega negativa', async () => {
    const p = await armarPrueba()
    const { aceite, oc } = await aceiteConOrden(p)
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})
    const r = await Promise.all([p.pedir('us_a_member', 'POST', `/api/servicio/insumos/${aceite}/sacar`, { cantidad: 15 }), p.pedir('us_a_member', 'POST', `/api/servicio/insumos/${aceite}/sacar`, { cantidad: 15 })])
    expect(r.map((x) => x.estado).sort()).toEqual([200, 409])
    expect(await stockDe(p, aceite)).toBe(5)
  })

  it('el ajuste deja lo contado aunque alguien haya sacado recién', async () => {
    const p = await armarPrueba()
    const { aceite, oc } = await aceiteConOrden(p)
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})
    await Promise.all([p.pedir('us_a_jefe', 'POST', `/api/servicio/insumos/${aceite}/ajustar`, { stock: 18, nota: 'Conteo del viernes' }), p.pedir('us_a_member', 'POST', `/api/servicio/insumos/${aceite}/sacar`, { cantidad: 3 })])
    // Se contó 18 y se sacaron 3: según el orden queda 18 o 15, nunca otra cosa.
    expect([15, 18]).toContain(await stockDe(p, aceite))
  })
})

describe('los parecidos de bodega', () => {
  it('un repuesto sin letras ni números no se parece a todo', () => {
    const articulos = [{ nombre: 'Aceite 15W40', codigo: null, stock: 10, tipo: 'supply' as const, activo: true }]
    expect(candidatosDeBodega(articulos, { descripcion: '..', codigo: null, cantidad: 1 })).toEqual([])
  })
})
