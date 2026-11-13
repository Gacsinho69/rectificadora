import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { diagnosticoDeRecepcion, nombreDePieza, ordenDeGrupo, piezasSueltas, unidadDe } from './reglas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>

/** Una sección de trabajo (no la de recepción) de la rectificadora de `quien`. */
async function seccionDe(p: Prueba, quien: string) {
  const catalogo = (await p.pedir(quien, 'GET', '/api/servicio/catalogo')).cuerpo as { secciones: { id: string; diagnostico: boolean }[] }
  return catalogo.secciones.find((s) => !s.diagnostico)!.id
}
const turboDe = (seccionId: string, pieza: string) => ({ nombre: 'Reparación de turbo', seccionId, pieza, criterio: 'fixed', precio: 120_000, horas: 3, tipico: true })

describe('las piezas propias del taller', () => {
  it('se nombran, se ordenan después de las de siempre y antes de «otra», y no pasan por las pruebas de fisuras', () => {
    const propias = [{ id: 'pz_turbo', nombre: 'Turbo', activa: true }, { id: 'pz_bomba', nombre: 'Bomba inyectora', activa: false }]
    expect(nombreDePieza('culata', propias)).toBe('Culata')
    expect(nombreDePieza('pz_turbo', propias)).toBe('Turbo')
    expect(piezasSueltas(propias)).toEqual(['culata', 'block', 'cigüeñal', 'bielas', 'árbol', 'pz_turbo', 'otra'])
    expect(piezasSueltas(propias, true)).toContain('pz_bomba')
    expect(ordenDeGrupo('árbol', propias) < ordenDeGrupo('pz_turbo', propias)).toBe(true)
    expect(ordenDeGrupo('pz_turbo', propias) < ordenDeGrupo('pz_bomba', propias)).toBe(true)
    expect(ordenDeGrupo('pz_bomba', propias) < ordenDeGrupo('otra', propias)).toBe(true)
    expect(unidadDe('fixed', 'pz_turbo', propias)).toBe('turbo')
    expect(diagnosticoDeRecepcion(['pz_turbo'])).toEqual([])
    expect(diagnosticoDeRecepcion(['culata', 'pz_turbo'])).toEqual(['D-03', 'D-04'])
    expect(diagnosticoDeRecepcion(['motor'])).toEqual(['D-01', 'D-02'])
  })

  it('el administrador agrega un turbo: se recibe, tiene sus actividades, va en la OT con su nombre y se estima su entrega', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/piezas', { nombre: 'Turbo' })).estado).toBe(403)
    const { id: turbo } = (await p.pedir('us_a_admin', 'POST', '/api/servicio/piezas', { nombre: 'Turbo' })).cuerpo
    expect(turbo).toMatch(/^pz_/)
    expect((await p.pedir('us_a_admin', 'POST', '/api/servicio/piezas', { nombre: ' TURBO ' })).cuerpo.error).toContain('Ya hay una pieza «Turbo»')
    expect((await p.pedir('us_a_admin', 'POST', '/api/servicio/piezas', { nombre: 'culata' })).cuerpo.error).toContain('piezas de siempre')
    // El técnico las ve, para saber qué tiene en las manos.
    expect((await p.pedir('us_a_member', 'GET', '/api/servicio/piezas')).cuerpo).toEqual({ propias: [{ id: turbo, nombre: 'Turbo', activa: true }] })

    const seccion = await seccionDe(p, 'us_a_admin')
    const actividad = await p.pedir('us_a_admin', 'POST', '/api/servicio/catalogo', turboDe(seccion, turbo))
    expect(actividad.estado).toBe(200)
    const catalogo = (await p.pedir('us_a_admin', 'GET', '/api/servicio/catalogo')).cuerpo as { trabajos: { id: string; pieza: string; unidad: string }[] }
    expect(catalogo.trabajos.find((t) => t.id === actividad.cuerpo.id)).toMatchObject({ pieza: turbo, unidad: 'turbo' })

    // Llega un turbo solo: nace la OT sin pruebas de fisuras, y su entrega se estima con su actividad típica.
    const sugerida = await p.pedir('us_a_jefe', 'GET', `/api/servicio/entrega-sugerida?piezas=${turbo}`)
    expect(sugerida.cuerpo.dias).toBeGreaterThan(0)
    const ot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Garrett GT45', piezas: [turbo, turbo] })).cuerpo
    let detalle = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${ot.id}`)).cuerpo
    expect(detalle.piezas).toEqual([turbo])
    expect(detalle.tareas).toEqual([])
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${ot.id}/tareas`, { trabajoId: actividad.cuerpo.id })).estado).toBe(200)
    detalle = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${ot.id}`)).cuerpo
    expect(detalle.porPieza).toMatchObject([{ clave: turbo, nombre: 'Turbo', total: 1 }])

    // Una cotización puede llevar líneas del turbo.
    const linea = { tipo: 'trabajo', trabajoId: actividad.cuerpo.id, seccionId: seccion, codigo: null, descripcion: 'Reparación de turbo', cantidad: 1, precio: 120_000, horas: 3, pieza: turbo, criterio: 'fixed' }
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', motor: 'Garrett GT45', lineas: [linea] })).estado).toBe(200)

    // Renombrada, se nombra así en todas partes; fuera de uso, ya no se recibe ni se le crean actividades.
    await p.pedir('us_a_admin', 'POST', `/api/servicio/piezas/${turbo}`, { nombre: 'Turbo y turbina' })
    expect((await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${ot.id}`)).cuerpo.porPieza[0].nombre).toBe('Turbo y turbina')
    await p.pedir('us_a_admin', 'POST', `/api/servicio/piezas/${turbo}`, { activa: false })
    const fuera = await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Garrett GT45', piezas: [turbo] })
    expect(fuera.estado).toBe(409)
    expect(fuera.cuerpo.error).toContain('ya no se usa')
    expect((await p.pedir('us_a_admin', 'POST', '/api/servicio/catalogo', turboDe(seccion, turbo))).estado).toBe(409)
    // Lo que no es pieza no pasa.
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Garrett GT45', piezas: ['volante'] })).estado).toBe(400)
  })

  it('aislamiento: otra rectificadora no ve, no renombra ni usa las piezas propias de una', async () => {
    const p = await armarPrueba()
    const { id: turbo } = (await p.pedir('us_a_admin', 'POST', '/api/servicio/piezas', { nombre: 'Turbo' })).cuerpo
    expect((await p.pedir('us_b_admin', 'GET', '/api/servicio/piezas')).cuerpo).toEqual({ propias: [] })
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/piezas/${turbo}`, { nombre: 'Mío' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', '/api/servicio/ot', { clienteId: 'cl_b', motor: 'Garrett GT45', piezas: [turbo] })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', '/api/servicio/catalogo', turboDe(await seccionDe(p, 'us_b_admin'), turbo))).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'GET', `/api/servicio/entrega-sugerida?piezas=${turbo}`)).estado).toBe(404)
    const linea = { tipo: 'otro', trabajoId: null, seccionId: null, codigo: null, descripcion: 'Turbo ajeno', cantidad: 1, precio: 1000, horas: 0, pieza: turbo }
    expect((await p.pedir('us_b_admin', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_b', motor: 'Garrett GT45', lineas: [linea] })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(5)
    expect((await p.pedir('us_a_admin', 'GET', '/api/servicio/piezas')).cuerpo.propias[0].nombre).toBe('Turbo')
  })
})
