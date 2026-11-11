import { describe, expect, it } from 'vitest'
import { faltasParaEnviar, totales } from '../comercial/reglas'
import { avanceDeOt, type DatosEstadoOt, estadoDeOt, plazoDeOt } from './reglas'

const base: DatosEstadoOt = { anulada: false, entregada: false, calidadAprobada: false, tareas: [], cotizacion: null }
const diag = (estado: 'pending' | 'in_progress' | 'done') => ({ diagnostico: true, estado })
const trabajo = (estado: 'pending' | 'in_progress' | 'done') => ({ diagnostico: false, estado })

describe('el estado de la OT sale de lo que pasó', () => {
  it('de la recepción a la entrega', () => {
    expect(estadoDeOt({ ...base, tareas: [diag('pending')] })).toBe('received')
    expect(estadoDeOt({ ...base, tareas: [diag('in_progress')] })).toBe('diagnosis')
    expect(estadoDeOt({ ...base, tareas: [diag('done')], cotizacion: 'sent' })).toBe('waiting_approval')
    expect(estadoDeOt({ ...base, tareas: [diag('done'), trabajo('pending')], cotizacion: 'accepted' })).toBe('in_progress')
    expect(estadoDeOt({ ...base, tareas: [diag('done'), trabajo('done')], cotizacion: 'accepted' })).toBe('quality')
    expect(estadoDeOt({ ...base, tareas: [trabajo('done')], calidadAprobada: true })).toBe('ready')
    expect(estadoDeOt({ ...base, calidadAprobada: true, entregada: true })).toBe('delivered')
    expect(estadoDeOt({ ...base, tareas: [trabajo('pending')], anulada: true })).toBe('cancelled')
  })

  it('una cotización rechazada devuelve la OT al diagnóstico (se entrega sin reparar o se recotiza)', () => {
    expect(estadoDeOt({ ...base, tareas: [diag('done')], cotizacion: 'rejected' })).toBe('diagnosis')
  })
})

describe('avance y plazo', () => {
  it('el avance pesa por horas estándar; lo en proceso cuenta la mitad', () => {
    expect(avanceDeOt([{ estado: 'done', minutos: 60 }, { estado: 'pending', minutos: 180 }])).toBe(0.25)
    expect(avanceDeOt([{ estado: 'in_progress', minutos: 60 }, { estado: 'done', minutos: 60 }])).toBe(0.75)
    expect(avanceDeOt([])).toBe(0)
  })

  it('atrasada, por vencer o a tiempo; cerrada no tiene plazo', () => {
    expect(plazoDeOt('2026-11-10', 'in_progress', '2026-11-11')).toBe('atrasada')
    expect(plazoDeOt('2026-11-13', 'in_progress', '2026-11-11')).toBe('por_vencer')
    expect(plazoDeOt('2026-11-20', 'in_progress', '2026-11-11')).toBeNull()
    expect(plazoDeOt('2026-11-10', 'delivered', '2026-11-11')).toBeNull()
  })
})

describe('la cotización', () => {
  it('suma, descuenta y agrega IVA; cada línea al peso', () => {
    expect(totales([{ cantidad: 12, precio: 8_000 }, { cantidad: 1, precio: 55_000 }], 10)).toEqual({ subtotal: 151_000, rebaja: 15_100, neto: 135_900, iva: 25_821, total: 161_721 })
  })

  it('no se envía vacía ni con precios faltantes', () => {
    expect(faltasParaEnviar([])).toHaveLength(1)
    expect(faltasParaEnviar([{ descripcion: 'Nitrurado', precio: null }])[0]).toContain('Nitrurado')
    expect(faltasParaEnviar([{ descripcion: 'Cepillado', precio: 55_000 }])).toEqual([])
  })
})
