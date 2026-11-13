import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { diasParaTerminar, fechaTrasDiasHabiles } from './reglas'

describe('la entrega sugerida', () => {
  it('cuenta los días de lunes a sábado', () => {
    expect(fechaTrasDiasHabiles('2026-11-13', 1)).toBe('2026-11-14')
    expect(fechaTrasDiasHabiles('2026-11-14', 1)).toBe('2026-11-16')
    expect(fechaTrasDiasHabiles('2026-11-11', 2.2)).toBe('2026-11-14')
    expect(fechaTrasDiasHabiles('2026-11-11', 0)).toBe('2026-11-12')
  })

  it('las piezas van a la vez; el armado espera a la más lenta y a los repuestos; el diagnóstico va antes', () => {
    const colas = new Map([
      ['diag', { dias: 0, horasPorDia: 8 }],
      ['culatas', { dias: 1, horasPorDia: 8 }],
      ['block', { dias: 2, horasPorDia: 8 }],
      ['armado', { dias: 0, horasPorDia: 16 }],
    ])
    const trabajos = [
      { seccionId: 'diag', pieza: 'motor' as const, diagnostico: true, horas: 4 },
      { seccionId: 'culatas', pieza: 'culata' as const, diagnostico: false, horas: 8 },
      { seccionId: 'block', pieza: 'block' as const, diagnostico: false, horas: 4 },
      { seccionId: 'armado', pieza: 'motor' as const, diagnostico: false, horas: 8 },
    ]
    // Diagnóstico 0,5 + el block (2 de cola + 0,5) + el armado 0,5.
    expect(diasParaTerminar(trabajos, colas)).toBe(3.5)
    // Si los repuestos tardan 4 días, el armado los espera.
    expect(diasParaTerminar(trabajos, colas, 4)).toBe(5)
  })

  it('al recibir y en cada OT, con la cola de hoy; solo lo propio', async () => {
    const p = await armarPrueba()
    const r = await p.pedir('us_a_jefe', 'GET', '/api/servicio/entrega-sugerida?piezas=motor&cilindros=6&valvulasPorCilindro=4')
    expect(r.estado).toBe(200)
    expect(r.cuerpo.dias).toBeGreaterThan(2)
    expect(r.cuerpo.fecha > '2026-11-11').toBe(true)
    // Una culata sola se hace antes que un motor completo.
    const culata = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/entrega-sugerida?piezas=culata&cilindros=6')).cuerpo
    expect(culata.dias).toBeLessThan(r.cuerpo.dias)
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/entrega-sugerida?piezas=nada')).estado).toBe(400)

    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['motor'] })).cuerpo
    const deLaOt = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}/entrega-sugerida`)).cuerpo
    expect(deLaOt).toMatchObject({ fecha: expect.any(String) })
    expect((await p.pedir('us_b_admin', 'GET', `/api/servicio/ot/${otId}/entrega-sugerida`)).estado).toBe(404)
    // Anulada, ya no se estima.
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/anular`, { motivo: 'El cliente se lo llevó' })
    expect((await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}/entrega-sugerida`)).cuerpo).toBeNull()
  })
})
