import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { horasDeJornada, horasReales, rendimientoDe } from './reglas'
import { workOrderTasks } from './tablas'

/** Un momento en hora de Chile (UTC−3): «2026-11-13 18:00». */
const cl = (s: string) => new Date(`${s.replace(' ', 'T')}:00-03:00`)

describe('las horas reales', () => {
  it('se cuentan de 8 a 19, de lunes a sábado; las noches y los domingos no cuentan', () => {
    expect(horasDeJornada(cl('2026-11-11 10:00'), cl('2026-11-11 12:30'))).toBe(2.5)
    // Del viernes a las 18 al lunes a las 9: una hora el viernes, el sábado entero, nada el domingo, una el lunes.
    expect(horasDeJornada(cl('2026-11-13 18:00'), cl('2026-11-16 09:00'))).toBe(13)
    expect(horasDeJornada(cl('2026-11-11 20:00'), cl('2026-11-12 07:30'))).toBe(0)
    expect(horasDeJornada(cl('2026-11-12 07:00'), cl('2026-11-11 10:00'))).toBe(0)
  })

  it('sin lo que estuvo detenido; con la detención abierta, hasta el término', () => {
    expect(horasReales(cl('2026-11-11 09:00'), cl('2026-11-11 13:00'), [{ desde: cl('2026-11-11 10:00'), hasta: cl('2026-11-11 11:00') }])).toBe(3)
    expect(horasReales(cl('2026-11-11 09:00'), cl('2026-11-11 13:00'), [{ desde: cl('2026-11-11 12:00'), hasta: null }])).toBe(3)
    expect(rendimientoDe([{ estandar: 4, real: 3, cantidad: 1 }, { estandar: 2, real: 3, cantidad: 2 }])).toEqual({ trabajos: 2, estandar: 6, real: 6, proporcion: 1, realPorUnidad: 2 })
  })

  it('el rendimiento por actividad y por persona, solo para el jefe de taller y el administrador, y solo lo propio', async () => {
    const p = await armarPrueba()
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['motor'] })).cuerpo
    const tareas = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas as { id: string; nombre: string }[]
    for (const t of tareas) await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${t.id}/terminar`, {})
    // El desarme se empezó a las 9 (la prueba corre a las 12 de Chile): tomó 3 horas contra 4 estándar.
    await p.base.update(workOrderTasks).set({ startedAt: new Date(p.ahora.getTime() - 3 * 3_600_000) }).where(eq(workOrderTasks.id, tareas[0].id))

    expect((await p.pedir('us_a_member', 'GET', '/api/servicio/rendimiento')).estado).toBe(403)
    const r = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/rendimiento?dias=30')).cuerpo
    expect(r.actividades.find((a: { codigo: string }) => a.codigo === 'D-01')).toMatchObject({ trabajos: 1, estandar: 4, real: 3, proporcion: 0.75, realPorUnidad: 3, horasEstandar: 4 })
    expect(r.personas).toEqual([expect.objectContaining({ id: 'us_a_member', trabajos: 2 })])
    const ot = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo
    expect(ot.tareas[0].horasReales).toBe(3)
    expect((await p.pedir('us_b_admin', 'GET', '/api/servicio/rendimiento')).cuerpo).toMatchObject({ actividades: [], personas: [], total: { trabajos: 0 } })
  })
})
