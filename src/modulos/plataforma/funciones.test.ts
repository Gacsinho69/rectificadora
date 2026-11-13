import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { services } from '../taller/tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
const motivo = 'El cliente bajó de plan'
const cambiar = (p: Prueba, funcion: string, activa: boolean) => p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/funciones', { funcion, activa, motivo })

describe('las funciones encienden módulos de verdad', () => {
  it('sin compras: no hay órdenes de compra ni proveedores, pero los repuestos se reciben en la OT', async () => {
    const p = await armarPrueba()
    expect((await cambiar(p, 'public_api', true)).estado).toBe(400)
    expect((await cambiar(p, 'purchasing', false)).estado).toBe(200)
    expect((await p.pedir('us_a_jefe', 'GET', '/api/yo')).cuerpo.actor.funciones).toEqual(['supplies', 'machines'])
    const compras = await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')
    expect(compras.estado).toBe(403)
    expect(compras.cuerpo.error).toContain('«Compras y proveedores»')
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/proveedores')).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: ['rep_x'], proveedorId: 'prv_x' })).estado).toBe(403)
    // Los repuestos de la OT siguen: se agregan y se reciben ahí.
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['motor'] })).cuerpo
    const rep = (await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Bomba de agua' })).cuerpo.id
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/repuestos/${rep}/recibir`)).estado).toBe(200)
    // La otra rectificadora no se ve afectada.
    expect((await p.pedir('us_b_admin', 'GET', '/api/servicio/compras')).estado).toBe(200)
    expect((await cambiar(p, 'purchasing', true)).estado).toBe(200)
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).estado).toBe(200)
  })

  it('sin bodega: no hay insumos ni se piden en la orden de compra', async () => {
    const p = await armarPrueba()
    const aceite = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/insumos', { nombre: 'Aceite de prueba', unidad: 'litro', minimo: 10 })).cuerpo.id
    const proveedor = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/proveedores', { nombre: 'Lubricantes del Sur' })).cuerpo.id
    await cambiar(p, 'supplies', false)
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/insumos')).estado).toBe(403)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/insumos/${aceite}/sacar`, { cantidad: 1 })).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo.insumosBajos).toEqual([])
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { insumos: [{ insumoId: aceite, cantidad: 5 }], proveedorId: proveedor })).estado).toBe(403)
  })

  it('sin máquinas: una parada no frena trabajos; al encenderlas de nuevo, sí', async () => {
    const p = await armarPrueba()
    const [b01] = await p.base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.code, 'B-01')))
    const { id: maquina } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Rectificadora de cilindros', actividades: [b01.id] })).cuerpo
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${maquina}/detener`, { motivo: 'breakdown', nota: 'Se cortó la correa' })
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'], diagnostico: false })).cuerpo
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/tareas`, { trabajoId: b01.id })
    const situacion = async () => ((await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas as { situacion: string }[])[0].situacion
    expect(await situacion()).toBe('machine')
    await cambiar(p, 'machines', false)
    expect(await situacion()).toBe('available')
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/maquinas')).estado).toBe(403)
    await cambiar(p, 'machines', true)
    expect(await situacion()).toBe('machine')
  })
})
