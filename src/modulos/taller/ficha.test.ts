import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { services } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type Ficha = {
  nombre: string
  situacion: string
  faltan: string[]
  indicaciones: string | null
  resultado: string | null
  anteriores: { nombre: string; resultado: string | null; quien: string | null }[]
  repuestos: { descripcion: string; medida: string | null; estado: string }[]
}

async function trabajo(base: Prueba['base'], codigo: string) {
  const [t] = await base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.code, codigo)))
  return { tipo: 'trabajo', trabajoId: t.id, seccionId: t.sectionId, codigo: t.code, descripcion: t.name, cantidad: t.criterion === 'per_cylinder' ? 6 : 1, precio: t.price, horas: t.stdHours, pieza: t.piece, criterio: t.criterion }
}

/** Un motor diagnosticado (con lo que anotó quien midió) y aprobado: rectificado de cilindros y armado. */
async function motorAprobado(p: Prueba) {
  const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Mercedes-Benz OM 457', piezas: ['motor'], cilindros: 6, falla: 'Consumo de aceite' })).cuerpo
  for (const t of (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas) {
    await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${t.id}/iniciar`, {})
    await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${t.id}/terminar`, { resultado: t.nombre.startsWith('Medición') ? 'Cilindros con 0,12 de ovalización: van a 0,50' : undefined })
  }
  const lineas = [await trabajo(p.base, 'B-01'), await trabajo(p.base, 'A-01')]
  const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: 'Mercedes-Benz OM 457', cilindros: 6, lineas })).cuerpo
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})
  const tareas = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas as { id: string; nombre: string }[]
  const de = (inicio: string) => tareas.find((t) => t.nombre.startsWith(inicio))!.id
  return { otId: otId as string, rectificado: de('Rectificado de cilindros'), armado: de('Armado') }
}

const fichaDe = async (p: Prueba, id: string, quien = 'us_a_member') => (await p.pedir(quien, 'GET', `/api/servicio/tareas/${id}`)).cuerpo as Ficha

describe('la ficha del trabajo', () => {
  it('el técnico ve lo que indicó el jefe y lo que se anotó antes en la pieza; pide el repuesto que le falta y no termina sin él', async () => {
    const p = await armarPrueba()
    const { rectificado, armado } = await motorAprobado(p)

    // Lo que anotó quien midió le llega al que rectifica, sin montos.
    let ficha = await fichaDe(p, rectificado)
    expect(ficha.anteriores.map((a) => [a.nombre, a.resultado])).toEqual([
      ['Desarme y lavado de motor', null],
      ['Medición y metrología (informe)', 'Cilindros con 0,12 de ovalización: van a 0,50'],
    ])
    expect(JSON.stringify(ficha)).not.toMatch(/costo|precio|proveedor/)

    // El jefe indica; el técnico no.
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${rectificado}/indicaciones`, { texto: 'A 0,50' })).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${rectificado}/indicaciones`, { texto: 'Rectificar a 0,50; pistones Mahle' })).estado).toBe(200)
    expect((await fichaDe(p, rectificado)).indicaciones).toBe('Rectificar a 0,50; pistones Mahle')

    // Empieza y le falta un pistón: lo pide. Queda por pedir en compras, y el trabajo no se termina hasta que llegue.
    await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${rectificado}/iniciar`, {})
    expect((await p.pedir('us_a_lector', 'POST', `/api/servicio/tareas/${rectificado}/repuestos`, { descripcion: 'Pistón' })).estado).toBe(403)
    const pedido = await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${rectificado}/repuestos`, { descripcion: 'Pistón', cantidad: 1, medida: '0,50' })
    expect(pedido.estado).toBe(200)
    const { porPedir } = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/compras')).cuerpo
    expect(porPedir).toMatchObject([{ id: pedido.cuerpo.id, descripcion: 'Pistón', necesita: 'Rectificado de cilindros (6 cilindros)' }])
    ficha = await fichaDe(p, rectificado)
    expect(ficha).toMatchObject({ situacion: 'in_progress', faltan: ['Pistón'], repuestos: [{ descripcion: 'Pistón', medida: '0,50', estado: 'pending' }] })
    const sinPiston = await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${rectificado}/terminar`, { resultado: 'Listo' })
    expect(sinPiston.estado).toBe(409)
    expect(sinPiston.cuerpo.error).toContain('Falta que llegue: Pistón')

    // Llega y termina, anotando la medida final: la lee quien arma.
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/repuestos/${pedido.cuerpo.id}/recibir`)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${rectificado}/terminar`, { resultado: 'Cilindros a 0,50; bruñido 45°' })).estado).toBe(200)
    expect((await fichaDe(p, rectificado)).resultado).toBe('Cilindros a 0,50; bruñido 45°')
    expect((await fichaDe(p, armado)).anteriores.at(-1)).toMatchObject({ nombre: 'Rectificado de cilindros (6 cilindros)', resultado: 'Cilindros a 0,50; bruñido 45°', quien: 'us_a_member' })
    const historia = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${(await p.pedir('us_a_jefe', 'GET', '/api/servicio/ot')).cuerpo.filas[0].id}`)).cuerpo.historia as { que: string; quien: string | null }[]
    expect(historia).toContainEqual(expect.objectContaining({ que: 'Repuesto pedido: Pistón (0,50)', quien: 'us_a_member' }))
  })

  it('aislamiento: otra rectificadora no ve la ficha, no indica ni pide repuestos, y cada intento queda anotado', async () => {
    const p = await armarPrueba()
    const { rectificado } = await motorAprobado(p)
    expect((await p.pedir('us_b_admin', 'GET', `/api/servicio/tareas/${rectificado}`)).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/tareas/${rectificado}/indicaciones`, { texto: 'Hola' })).estado).toBe(404)
    expect((await p.pedir('us_b_member', 'POST', `/api/servicio/tareas/${rectificado}/repuestos`, { descripcion: 'Pistón' })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(3)
    expect((await fichaDe(p, rectificado, 'us_a_jefe')).indicaciones).toBeNull()
  })
})
