import { describe, expect, it } from 'vitest'
import { type ActividadDeLista, desglose, faltasParaEnviar, recontar, totales } from '../comercial/reglas'
import {
  anteriores,
  avanceDeOt,
  cantidadSegun,
  type DatosEstadoOt,
  type EstadoTarea,
  estadoDeOt,
  type Motor,
  nombreDeTarea,
  type Pieza,
  piezasDeOt,
  plazoDeOt,
  responsableDe,
  situacionDe,
  TRABAJOS_INICIALES,
  type TrabajoEnRuta,
} from './reglas'

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

const en = (id: string, pieza: Pieza, paso: number, estado: EstadoTarea = 'pending', extra: Partial<TrabajoEnRuta> = {}): TrabajoEnRuta => ({ id, pieza, paso, estado, detenido: false, adelantado: false, ...extra })

describe('la ruta de cada pieza', () => {
  const desarme = en('d', 'motor', 10, 'done')
  const cepillado = en('c1', 'culata', 120)
  const asientos = en('c2', 'culata', 150)
  const valvulas = en('c3', 'culata', 150)
  const cilindros = en('b1', 'block', 140)
  const armado = en('a', 'motor', 210)
  const ot = [desarme, cepillado, asientos, valvulas, cilindros, armado]

  it('cada pieza avanza a la vez que las otras, un paso tras otro; el mismo paso va a la vez', () => {
    expect(situacionDe(cepillado, ot)).toBe('available')
    expect(situacionDe(cilindros, ot)).toBe('available')
    expect(situacionDe(asientos, ot)).toBe('waiting')
    expect(anteriores(asientos, ot).map((t) => t.id)).toEqual(['c1'])
    expect(anteriores(valvulas, ot).map((t) => t.id)).toEqual(['c1'])
  })

  it('el desarme va antes que todo y el armado espera a todas las piezas', () => {
    expect(situacionDe(cepillado, [{ ...desarme, estado: 'in_progress' }, cepillado])).toBe('waiting')
    expect(anteriores(armado, ot).map((t) => t.id)).toEqual(['c1', 'c2', 'c3', 'b1'])
    const listas = ot.map((t) => (t.pieza === 'motor' ? t : { ...t, estado: 'done' as const }))
    expect(situacionDe(armado, listas)).toBe('available')
  })

  it('detenido manda; lo adelantado se puede empezar aunque falte lo anterior', () => {
    expect(situacionDe({ ...cepillado, detenido: true }, ot)).toBe('held')
    expect(situacionDe({ ...asientos, adelantado: true }, ot)).toBe('available')
    expect(situacionDe({ ...asientos, adelantado: true, detenido: true }, ot)).toBe('held')
    expect(situacionDe(en('x', 'culata', 150, 'in_progress'), ot)).toBe('in_progress')
  })

  it('cómo va cada pieza: lo que la tiene ocupada', () => {
    const conSituacion = ot.map((t) => ({ ...t, diagnostico: t.id === 'd', minutos: 60, situacion: situacionDe(t, ot) }))
    const piezas = piezasDeOt(conSituacion)
    expect(piezas.map((p) => p.clave)).toEqual(['diagnostico', 'culata', 'block', 'motor'])
    expect(piezas.find((p) => p.clave === 'culata')).toMatchObject({ nombre: 'Culata', situacion: 'available', total: 3, hechas: 0 })
    expect(piezas.find((p) => p.clave === 'motor')).toMatchObject({ nombre: 'Armado y control', situacion: 'waiting' })
    expect(piezas[0]).toMatchObject({ situacion: 'done', avance: 1 })
  })
})

describe('a quién va cada trabajo', () => {
  const gente = [
    { id: 'pedro', nombre: 'Pedro', minutos: 300 },
    { id: 'ana', nombre: 'Ana', minutos: 120 },
  ]
  it('a quien ya tiene esa pieza de la OT, si también hace la actividad', () => {
    expect(responsableDe({ pieza: 'culata' }, [{ pieza: 'culata', asignado: 'pedro' }], gente)).toBe('pedro')
    // Juan tiene la culata, pero no hace esta actividad: va a quien la hace con menos horas.
    expect(responsableDe({ pieza: 'culata' }, [{ pieza: 'culata', asignado: 'juan' }], gente)).toBe('ana')
  })
  it('si no, al especialista con menos horas pendientes; sin especialistas, a nadie', () => {
    expect(responsableDe({ pieza: 'block' }, [{ pieza: 'culata', asignado: 'pedro' }], gente)).toBe('ana')
    expect(responsableDe({ pieza: 'block' }, [], [])).toBeNull()
    expect(responsableDe({ pieza: 'block' }, [], [{ id: 'b', nombre: 'Beto', minutos: 60 }, { id: 'a', nombre: 'Ana', minutos: 60 }])).toBe('a')
  })
})

describe('cómo se cuenta cada actividad', () => {
  const seis: Motor = { cilindros: 6, valvulasPorCilindro: 4, culatas: 1 }
  it('por cilindro, válvula, biela, culata o una vez', () => {
    expect(cantidadSegun('per_cylinder', seis)).toBe(6)
    expect(cantidadSegun('per_valve', seis)).toBe(24)
    expect(cantidadSegun('per_rod', seis)).toBe(6)
    expect(cantidadSegun('per_head', { ...seis, culatas: 2 })).toBe(2)
    expect(cantidadSegun('fixed', seis)).toBe(1)
    expect(cantidadSegun('per_cylinder', { ...seis, cilindros: 3 })).toBe(3)
  })

  it('el nombre del trabajo dice cuánto', () => {
    expect(nombreDeTarea('Rectificado de cilindros', 6, 'per_cylinder')).toBe('Rectificado de cilindros (6 cilindros)')
    expect(nombreDeTarea('Cepillado de culata', 1, 'per_head')).toBe('Cepillado de culata')
    expect(nombreDeTarea('Pintura de motor', 2, 'fixed')).toBe('Pintura de motor ×2')
  })

  it('la prueba hidráulica de culata se cobra por cilindro: la culata más grande cuesta más', () => {
    const hidraulica = TRABAJOS_INICIALES.find((t) => t.codigo === 'D-04')!
    expect(hidraulica).toMatchObject({ nombre: 'Prueba hidráulica de culata', criterio: 'per_cylinder', pieza: 'culata' })
    expect(cantidadSegun(hidraulica.criterio, seis) * hidraulica.precio!).toBe(60_000)
    expect(cantidadSegun(hidraulica.criterio, { ...seis, cilindros: 4 }) * hidraulica.precio!).toBe(40_000)
  })

  const lista = (codigos: string[]): ActividadDeLista[] =>
    TRABAJOS_INICIALES.filter((t) => codigos.includes(t.codigo)).map((t) => ({ id: t.codigo, seccionId: t.seccion, codigo: t.codigo, nombre: t.nombre, precio: t.precio, horas: t.horas, pieza: t.pieza, paso: t.paso, criterio: t.criterio, tipico: t.tipico, activo: true }))

  it('el desglose trae lo típico de cada pieza, contado y en el orden de su ruta, sin repetir', () => {
    const actividades = lista(['D-01', 'D-02', 'D-04', 'C-01', 'C-02', 'C-03', 'C-06', 'B-01', 'B-02', 'B-05', 'A-01', 'Q-01'])
    const lineas = desglose(actividades, ['motor', 'culata', 'block'], seis, [], new Set(['diagnostico']))
    expect(lineas.map((l) => l.codigo)).toEqual(['D-01', 'D-02', 'D-04', 'C-01', 'C-02', 'C-03', 'C-06', 'B-01', 'B-02', 'A-01', 'Q-01'])
    expect(lineas.find((l) => l.codigo === 'C-02')).toMatchObject({ cantidad: 24, criterio: 'per_valve', pieza: 'culata' })
    expect(desglose(actividades, ['culata'], seis, lineas, new Set(['diagnostico']))).toEqual([])
  })

  it('si cambian los cilindros, las líneas por cilindro se cuentan de nuevo; las de una vez y las a mano no', () => {
    const lineas = desglose(lista(['B-01', 'D-02']), ['block', 'motor'], seis, [], new Set(['diagnostico']))
    const cuatro = recontar([...lineas, { tipo: 'repuesto', trabajoId: null, seccionId: null, codigo: null, descripcion: 'Pistones', cantidad: 6, precio: 70_000, horas: 0 }], { ...seis, cilindros: 4 })
    expect(cuatro.map((l) => l.cantidad)).toEqual([1, 4, 6])
  })
})
