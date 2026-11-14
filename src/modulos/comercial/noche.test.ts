// Lo que se arregló en la revisión de cotizaciones: decisiones a la vez, la anulación con su evento, enviar con la OT
// cerrada y los mensajes que dicen qué línea falta.
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { services } from '../taller/tablas'
import { faltasParaEnviar } from './reglas'
import { quotes } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
async function linea(p: Prueba) {
  const [t] = await p.base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.code, 'C-01')))
  return { tipo: 'trabajo', trabajoId: t.id, seccionId: t.sectionId, codigo: t.code, descripcion: t.name, cantidad: 1, precio: t.price, horas: t.stdHours }
}
async function enviada(p: Prueba, otId: string | null = null) {
  const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: 'Cummins ISX15', lineas: [await linea(p)] })).cuerpo
  expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)).estado).toBe(200)
  return cot.id as string
}
const estadoDe = async (p: Prueba, id: string) => (await p.base.select().from(quotes).where(eq(quotes.id, id)))[0].status

describe('dos decisiones a la vez', () => {
  it('aceptar y rechazar juntos: gana una y la otra sabe que ya se decidió', async () => {
    const p = await armarPrueba()
    const id = await enviada(p)
    const [a, r] = await Promise.all([p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${id}/aceptar`, {}), p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${id}/rechazar`, { nota: 'Muy caro' })])
    expect([a.estado, r.estado].sort()).toEqual([200, 409])
    expect(await estadoDe(p, id)).toBe(a.estado === 200 ? 'accepted' : 'rejected')
  })

  it('aceptar y anular juntos: la anulación no pisa una aceptación', async () => {
    const p = await armarPrueba()
    const id = await enviada(p)
    const [a, n] = await Promise.all([p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${id}/aceptar`, {}), p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${id}/anular`, { nota: 'Precio equivocado' })])
    expect([a.estado, n.estado].sort()).toEqual([200, 409])
    expect(await estadoDe(p, id)).toBe(a.estado === 200 ? 'accepted' : 'cancelled')
  })

  it('anular deja su evento con el motivo', async () => {
    const p = await armarPrueba()
    const id = await enviada(p)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${id}/anular`, { nota: 'Precio equivocado' })).estado).toBe(200)
    const [e] = await p.eventos('quote.cancelled')
    expect(e).toMatchObject({ tenantId: 'tn_a', targetId: id, metadata: { estado_anterior: 'sent', motivo: 'Precio equivocado' } })
  })
})

describe('enviar y los mensajes', () => {
  it('no se envía una cotización cuya OT ya se cerró', async () => {
    const p = await armarPrueba()
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo
    const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: 'Cummins ISX15', lineas: [await linea(p)] })).cuerpo
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/anular`, { motivo: 'El cliente se lo llevó' })
    const r = await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('ya se cerró')
  })

  it('una línea sin descripción dice cuál es, al guardar y antes de enviar', async () => {
    const p = await armarPrueba()
    const r = await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', motor: 'Cummins ISX15', lineas: [await linea(p), { ...(await linea(p)), descripcion: '' }] })
    expect(r.estado).toBe(400)
    expect(r.cuerpo.error).toContain('(línea 2)')
    expect(faltasParaEnviar([{ descripcion: 'Culata', precio: 10 }, { descripcion: ' ', precio: 10 }])).toContain('Falta la descripción de la línea 2.')
  })

  it('un estado que no existe no devuelve todas las cotizaciones', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/cotizaciones?estado=xyz')).estado).toBe(400)
  })

  it('las OT del cliente traen su motor, para copiarlo al cotizar', async () => {
    const p = await armarPrueba()
    await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'], cilindros: 6, valvulasPorCilindro: 4 })
    const [ot] = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/clientes/cl_a/ot')).cuerpo
    expect(ot).toMatchObject({ cilindros: 6, valvulasPorCilindro: 4, culatas: null })
  })
})
