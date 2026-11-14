// Lo que se arregló en la revisión de compras y bodega: emitir y anular a la vez, el chofer de solo lectura, los
// movimientos de cada insumo y el costo real sin cotizar.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { nuevoId } from '../../ids'
import { armarPrueba } from '../../pruebas'
import { users } from '../usuarios/tablas'
import { comparacionDeCostos, insumoSchema } from './reglas'
import { purchaseOrders, purchaseOrderSupplies, supplies, supplyMovements, workOrderParts } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
const proveedor = async (p: Prueba, nombre = 'Repuestos Diesel Sur') => (await p.pedir('us_a_jefe', 'POST', '/api/servicio/proveedores', { nombre })).cuerpo.id as string
const insumo = async (p: Prueba, nombre: string, extra: object = {}) => (await p.pedir('us_a_jefe', 'POST', '/api/servicio/insumos', { nombre, unidad: 'litro', ...extra })).cuerpo.id as string
async function repuestoPorPedir(p: Prueba) {
  const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo
  expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Kit de pistones', compra: 'shop' })).estado).toBe(200)
  const [r] = await p.base.select().from(workOrderParts).where(eq(workOrderParts.workOrderId, otId))
  return r.id
}
const stockDe = async (p: Prueba, id: string) => ((await p.pedir('us_a_jefe', 'GET', '/api/servicio/insumos')).cuerpo as { id: string; stock: number }[]).find((s) => s.id === id)!.stock

describe('las órdenes de compra con dos a la vez', () => {
  it('dos órdenes con el mismo repuesto a la vez: queda pedido en una sola', async () => {
    const p = await armarPrueba()
    const sur = await proveedor(p)
    const repuesto = await repuestoPorPedir(p)
    const r = await Promise.all([1, 2].map(() => p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: [repuesto], proveedorId: sur })))
    expect(r.map((x) => x.estado).sort()).toEqual([200, 409])
    expect(await p.base.select().from(purchaseOrders).where(eq(purchaseOrders.tenantId, 'tn_a'))).toHaveLength(1)
  })

  it('recibir y anular la misma orden a la vez: nunca queda anulada con la mercadería en bodega', async () => {
    const p = await armarPrueba()
    const sur = await proveedor(p)
    const aceite = await insumo(p, 'Aceite de prueba')
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: aceite, cantidad: 20 }], proveedorId: sur })).cuerpo
    const r = await Promise.all([p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {}), p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/anular`, { motivo: 'Sin stock' })])
    expect(r.map((x) => x.estado).sort()).toEqual([200, 409])
    const [orden] = await p.base.select().from(purchaseOrders).where(eq(purchaseOrders.id, oc.id))
    expect(await stockDe(p, aceite)).toBe(orden.status === 'cancelled' ? 0 : 20)
  })

  it('anular una orden deja su evento con el motivo', async () => {
    const p = await armarPrueba()
    const sur = await proveedor(p)
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: [await repuestoPorPedir(p)], proveedorId: sur })).cuerpo
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/anular`, { motivo: 'Sin stock' })).estado).toBe(200)
    const [e] = await p.eventos('purchase_order.cancelled')
    expect(e).toMatchObject({ tenantId: 'tn_a', targetId: oc.id, metadata: { motivo: 'Sin stock' } })
  })

  it('el chofer que pasó a solo lectura ya no recibe', async () => {
    const p = await armarPrueba()
    const sur = await proveedor(p)
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: [await repuestoPorPedir(p)], proveedorId: sur, choferId: 'us_a_member' })).cuerpo
    await p.base.update(users).set({ role: 'viewer' }).where(eq(users.id, 'us_a_member'))
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})).estado).toBe(403)
  })

  it('recibir con una línea de insumo de otro cliente queda anotado como intento', async () => {
    const p = await armarPrueba()
    const sur = await proveedor(p)
    const aceite = await insumo(p, 'Aceite de prueba')
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: aceite, cantidad: 5 }], proveedorId: sur })).cuerpo
    const ajeno = nuevoId('ocl')
    await p.base.insert(purchaseOrders).values({ id: 'oc_b', tenantId: 'tn_b', number: 1, supplier: 'Otro', status: 'open', createdAt: p.ahora })
    await p.base.insert(supplies).values({ id: 'ins_b', tenantId: 'tn_b', name: 'Aceite B', kind: 'supply', unit: 'litro', minStock: 0, stock: 0, active: true, createdAt: p.ahora })
    await p.base.insert(purchaseOrderSupplies).values({ id: ajeno, tenantId: 'tn_b', purchaseOrderId: 'oc_b', supplyId: 'ins_b', quantity: 3, status: 'ordered' })
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, { insumos: [ajeno] })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(1)
  })

  it('un insumo fuera de uso se nombra al emitir', async () => {
    const p = await armarPrueba()
    const sur = await proveedor(p)
    const aceite = await insumo(p, 'Aceite de prueba', { activo: false })
    const r = await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: aceite, cantidad: 5 }], proveedorId: sur })
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('Aceite de prueba')
  })
})

describe('la bodega', () => {
  it('un insumo que se usa poco muestra su historia aunque otro tenga cientos de movimientos', async () => {
    const p = await armarPrueba()
    const aceite = await insumo(p, 'Aceite de prueba')
    const pasta = await insumo(p, 'Pasta de esmeril')
    const hace = (dias: number) => new Date(p.ahora.getTime() - dias * 86_400_000)
    await p.base.insert(supplyMovements).values({ id: nuevoId('mov'), tenantId: 'tn_a', supplyId: pasta, quantity: 2, kind: 'adjust', note: 'Conteo', createdBy: 'us_a_jefe', createdAt: hace(60) })
    await p.base.insert(supplyMovements).values(Array.from({ length: 520 }, (_, i) => ({ id: nuevoId('mov'), tenantId: 'tn_a', supplyId: aceite, quantity: 1, kind: 'adjust' as const, note: 'Conteo', createdBy: 'us_a_jefe', createdAt: hace(i / 100) })))
    const lista = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/insumos')).cuerpo as { id: string; movimientos: unknown[] }[]
    expect(lista.find((s) => s.id === pasta)!.movimientos).toHaveLength(1)
    expect(lista.find((s) => s.id === aceite)!.movimientos).toHaveLength(5)
  })

  it('el mínimo vacío es cero', () => {
    expect(insumoSchema.parse({ nombre: 'Aceite', unidad: 'litro', minimo: null }).minimo).toBe(0)
  })

  it('lo pagado sin cotizar no queda «por anotar» para siempre', () => {
    const [g] = comparacionDeCostos([{ proveedor: 'Sur', cantidad: 1, costo: null, costoReal: 45_000 }, { proveedor: 'Sur', cantidad: 1, costo: 10_000, costoReal: null }])
    expect(g).toMatchObject({ lineas: 2, porAnotar: 1, cotizado: 0, real: 0 })
  })
})
