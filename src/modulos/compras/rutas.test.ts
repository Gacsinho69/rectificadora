import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { services } from '../taller/tablas'
import { usageDaily } from '../uso/tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type Tarea = { id: string; nombre: string; situacion: string; faltan: string[] }
type Repuesto = { id: string; descripcion: string; compra: string; estado: string; necesita: string | null; oc: string | null; proveedor: string | null; costo: number | null }

const recepcion = { clienteId: 'cl_a', motor: 'Mercedes-Benz OM 457', piezas: ['motor'], cilindros: 6, valvulasPorCilindro: 4, culatas: 1 }

async function trabajo(base: Prueba['base'], codigo: string) {
  const [t] = await base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.code, codigo)))
  return { tipo: 'trabajo', trabajoId: t.id, seccionId: t.sectionId, codigo: t.code, descripcion: t.name, cantidad: t.criterion === 'per_cylinder' ? 6 : 1, precio: t.price, horas: t.stdHours, pieza: t.piece, criterio: t.criterion }
}
const repuesto = (descripcion: string, extra: object) => ({ tipo: 'repuesto', trabajoId: null, seccionId: null, codigo: null, descripcion, cantidad: 1, horas: 0, ...extra })

/** Un motor con su diagnóstico terminado y la cotización aceptada: rectificado de cilindros y armado, con tres repuestos. */
async function motorConRepuestos(p: Prueba) {
  const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo
  for (const t of (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas) await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${t.id}/terminar`)
  const lineas = [
    await trabajo(p.base, 'B-01'),
    await trabajo(p.base, 'A-01'),
    repuesto('Kit de pistones', { precio: 420_000, compra: 'shop', proveedor: 'Repuestos Diesel Sur', costo: 300_000, necesita: 'B-01' }),
    repuesto('Juego de empaquetaduras', { precio: 150_000, compra: 'shop', proveedor: 'Repuestos Diesel Sur', costo: 100_000 }),
    repuesto('Bomba de aceite', { precio: null, compra: 'customer' }),
  ]
  const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: recepcion.motor, cilindros: 6, lineas })).cuerpo
  const envio = await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})
  return { otId: otId as string, cotId: cot.id as string, envio }
}

const otDe = async (p: Prueba, otId: string) => (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo as { tareas: Tarea[]; repuestos: Repuesto[]; historia: { que: string }[] }
const tarea = (tareas: Tarea[], inicio: string) => tareas.find((t) => t.nombre.startsWith(inicio))!
const deNombre = (repuestos: Repuesto[], inicio: string) => repuestos.find((r) => r.descripcion.startsWith(inicio))!

describe('los repuestos y las compras', () => {
  it('de la cotización al armado: quién compra, la orden de compra, el chofer y la recepción por partes', async () => {
    const p = await armarPrueba()
    const { otId, cotId, envio } = await motorConRepuestos(p)
    // Lo que trae el cliente no se cobra ni pide precio para enviar.
    expect(envio.estado).toBe(200)
    const cot = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/cotizaciones/${cotId}`)).cuerpo
    expect(cot.subtotal).toBe(6 * 22_000 + 6 * 90_000 + 420_000 + 150_000)

    let ot = await otDe(p, otId)
    expect(ot.repuestos.map((r) => [r.descripcion, r.compra, r.estado, r.necesita])).toEqual([
      ['Kit de pistones', 'shop', 'pending', 'Rectificado de cilindros (6 cilindros)'],
      ['Juego de empaquetaduras', 'shop', 'pending', 'Armado de motor completo (6 cilindros)'],
      ['Bomba de aceite', 'customer', 'pending', 'Armado de motor completo (6 cilindros)'],
    ])
    expect(tarea(ot.tareas, 'Rectificado de cilindros')).toMatchObject({ situacion: 'parts', faltan: ['Kit de pistones'] })
    expect(tarea(ot.tareas, 'Armado')).toMatchObject({ situacion: 'parts', faltan: ['Juego de empaquetaduras', 'Bomba de aceite'] })
    const r = await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${tarea(ot.tareas, 'Rectificado de cilindros').id}/iniciar`)
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('espera repuestos: Kit de pistones')

    // Las compras: lo que hay que pedir y lo que trae el cliente; el técnico no ve costos.
    const compras = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo
    expect(compras.porPedir.map((x: Repuesto) => x.descripcion)).toEqual(['Kit de pistones', 'Juego de empaquetaduras'])
    expect(compras.clientes.map((x: Repuesto) => x.descripcion)).toEqual(['Bomba de aceite'])
    expect(compras.porPedir[0].costo).toBe(300_000)
    expect((await p.pedir('us_a_member', 'GET', '/api/servicio/compras')).cuerpo.porPedir[0].costo).toBeNull()

    // La orden de compra, con el chofer que va a buscarlo.
    const ids = compras.porPedir.map((x: Repuesto) => x.id)
    const orden = { repuestos: ids, proveedor: 'Repuestos Diesel Sur', choferId: 'us_a_member', llega: '2026-11-14' }
    expect((await p.pedir('us_a_member', 'POST', '/api/servicio/compras/ordenes', orden)).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { ...orden, repuestos: [...ids, compras.clientes[0].id] })).estado).toBe(409)
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { ...orden, choferId: 'us_a_lector' })).estado).toBe(409)
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', orden)).cuerpo
    expect(oc.numero).toBe(1)
    expect(await p.eventos('purchase_order.created')).toHaveLength(1)
    const [uso] = await p.base.select().from(usageDaily).where(eq(usageDaily.tenantId, 'tn_a'))
    expect(uso.documents).toBe(2)
    expect(deNombre((await otDe(p, otId)).repuestos, 'Kit')).toMatchObject({ estado: 'ordered', oc: 'OC-0001' })

    // El chofer ve su retiro en el inicio y recibe lo que trajo: primero los pistones.
    const inicio = (await p.pedir('us_a_member', 'GET', '/api/servicio/inicio')).cuerpo
    expect(inicio.misRetiros).toEqual([{ id: oc.id, numero: 1, proveedor: 'Repuestos Diesel Sur', llega: '2026-11-14', repuestos: [{ descripcion: 'Kit de pistones', cantidad: 1, ot: 1 }, { descripcion: 'Juego de empaquetaduras', cantidad: 1, ot: 1 }] }])
    expect((await p.pedir('us_a_lector', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})).estado).toBe(403)
    const parcial = await p.pedir('us_a_member', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, { repuestos: [ids[0]] })
    expect(parcial.cuerpo).toMatchObject({ estado: 'open', recibidos: 1 })
    ot = await otDe(p, otId)
    expect(tarea(ot.tareas, 'Rectificado de cilindros').situacion).toBe('available')
    expect(tarea(ot.tareas, 'Armado')).toMatchObject({ situacion: 'parts', faltan: ['Juego de empaquetaduras', 'Bomba de aceite'] })
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})).cuerpo).toMatchObject({ estado: 'received', recibidos: 1 })
    expect(await p.eventos('purchase_order.received')).toHaveLength(1)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})).estado).toBe(409)

    // La bomba la trae el cliente: se recibe y el armado ya solo espera su turno.
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/repuestos/${compras.clientes[0].id}/recibir`)).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/repuestos/${compras.clientes[0].id}/recibir`)).estado).toBe(200)
    ot = await otDe(p, otId)
    expect(tarea(ot.tareas, 'Armado')).toMatchObject({ situacion: 'waiting', faltan: [] })
    expect(ot.repuestos.every((x) => x.estado === 'received')).toBe(true)
    expect(ot.historia.map((h) => h.que)).toContain('Llegó el repuesto: Kit de pistones')
  })

  it('anular: la orden sin nada recibido vuelve a por pedir; la OT anulada ya no espera sus repuestos', async () => {
    const p = await armarPrueba()
    const { otId } = await motorConRepuestos(p)
    const porPedir = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo.porPedir.map((x: Repuesto) => x.id)
    const primera = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: porPedir, proveedor: 'Repuestos Diesel Sur' })).cuerpo
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${primera.id}/anular`, { motivo: 'Sin stock' })).estado).toBe(200)
    let compras = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo
    expect(compras.porPedir).toHaveLength(2)
    expect(compras.ordenes[0]).toMatchObject({ numero: 1, estado: 'cancelled', motivo: 'Sin stock' })
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${primera.id}/anular`, { motivo: 'Otra vez' })).estado).toBe(409)

    // Con algo recibido, ya no se anula.
    const segunda = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: porPedir, proveedor: 'Importadora del Pacífico' })).cuerpo
    expect(segunda.numero).toBe(2)
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${segunda.id}/recibir`, { repuestos: [porPedir[0]] })
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${segunda.id}/anular`, { motivo: 'Ya no' })).estado).toBe(409)

    // Anular la OT: lo que no llegó ya no se espera, y la orden queda recibida con lo que llegó.
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/anular`, { motivo: 'El cliente retiró el motor' })
    const ot = await otDe(p, otId)
    expect(ot.repuestos.map((x) => x.estado)).toEqual(['received', 'cancelled', 'cancelled'])
    compras = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo
    expect(compras.ordenes.find((o: { numero: number }) => o.numero === 2).estado).toBe('received')
    expect(compras.porPedir).toHaveLength(0)
    expect(compras.clientes).toHaveLength(0)
  })

  it('un repuesto que aparece con la OT abierta: lo espera el trabajo elegido, o el armado', async () => {
    const p = await armarPrueba()
    const { otId } = await motorConRepuestos(p)
    const tareas = (await otDe(p, otId)).tareas
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Bomba de agua' })).estado).toBe(403)
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Bomba de agua', compra: 'shop', proveedor: 'Casa del Repuesto' })
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Anillos sobremedida', compra: 'shop', necesitaTareaId: tarea(tareas, 'Rectificado de cilindros').id })
    const ot = await otDe(p, otId)
    expect(deNombre(ot.repuestos, 'Bomba de agua')).toMatchObject({ necesita: 'Armado de motor completo (6 cilindros)', estado: 'pending', proveedor: 'Casa del Repuesto' })
    expect(tarea(ot.tareas, 'Rectificado de cilindros').faltan).toEqual(['Kit de pistones', 'Anillos sobremedida'])
    // El trabajo de otra OT no vale.
    const { id: otra } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo
    const ajena = (await otDe(p, otra)).tareas[0]
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Filtro', necesitaTareaId: ajena.id })).estado).toBe(400)
  })

  it('aislamiento: otra rectificadora no ve ni toca las compras, y cada intento queda anotado', async () => {
    const p = await armarPrueba()
    const { otId } = await motorConRepuestos(p)
    const compras = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo
    const [pistones] = compras.porPedir
    const oc = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/compras/ordenes', { repuestos: [pistones.id], proveedor: 'Repuestos Diesel Sur' })).cuerpo
    const { id: otDeB } = (await p.pedir('us_b_admin', 'POST', '/api/servicio/ot', { ...recepcion, clienteId: 'cl_b' })).cuerpo
    const tareaDeB = (await p.pedir('us_b_admin', 'GET', `/api/servicio/ot/${otDeB}`)).cuerpo.tareas[0]

    const deB = JSON.stringify((await p.pedir('us_b_admin', 'GET', '/api/servicio/compras')).cuerpo)
    expect(deB).not.toContain('Kit de pistones')
    expect((await p.pedir('us_b_admin', 'POST', '/api/servicio/compras/ordenes', { repuestos: [compras.porPedir[1].id], proveedor: 'Proveedor de B' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/compras/ordenes/${oc.id}/recibir`, {})).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/compras/ordenes/${oc.id}/anular`, { motivo: 'probando' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/compras/ordenes/${oc.id}/chofer`, { choferId: 'us_b_member' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/repuestos/${compras.clientes[0].id}/recibir`)).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Filtro' })).estado).toBe(404)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/compras/ordenes/${oc.id}/chofer`, { choferId: 'us_b_member' })).estado).toBe(404)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/repuestos`, { descripcion: 'Filtro', necesitaTareaId: tareaDeB.id })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(8)
    expect(deNombre((await otDe(p, otId)).repuestos, 'Kit')).toMatchObject({ estado: 'ordered' })
  })
})
