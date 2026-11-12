// Cómo trabaja una rectificadora, sin servidor: las pantallas importan esto igual.
//
// El recorrido de un motor (o de sus piezas) por el taller:
// 1. Recepción: llega el motor o las piezas; se anota cliente, motor, piezas, falla y la entrega comprometida. Nace la OT
//    con sus trabajos de diagnóstico (desarme, lavado y medición).
// 2. Diagnóstico: con lo que se midió se arma la cotización, pieza por pieza.
// 3. Aprobación: el cliente acepta y la OT se llena con los trabajos cotizados, cada uno en su sección.
// 4. Taller: desarmado, el motor deja de ser una sola cosa. Cada pieza (culata, block, cigüeñal, bielas) sigue su ruta,
//    un paso tras otro, con su especialista; las piezas avanzan a la vez y el armado las espera a todas.
// 5. Control de calidad, lista para entregar y entrega.

/** Las secciones con que nace cada rectificadora; cada una puede agregar las suyas. `diagnostico` marca la de recepción. */
export const SECCIONES_INICIALES = [
  { clave: 'diagnostico', nombre: 'Recepción y diagnóstico' },
  { clave: 'culatas', nombre: 'Culatas' },
  { clave: 'block', nombre: 'Block' },
  { clave: 'cigueñal', nombre: 'Cigüeñal y bielas' },
  { clave: 'armado', nombre: 'Armado' },
  { clave: 'calidad', nombre: 'Control de calidad' },
  { clave: 'terceros', nombre: 'Servicios de terceros' },
] as const
export type ClaveSeccion = (typeof SECCIONES_INICIALES)[number]['clave']

/** Cómo se cuenta una actividad al cotizar, con los datos del motor (hay motores de 3, 4, 5, 6 y 8 cilindros). */
export const CRITERIOS = { per_cylinder: 'Por cilindro', per_valve: 'Por válvula', per_rod: 'Por biela', per_head: 'Por culata', fixed: 'Una vez' } as const
export type Criterio = keyof typeof CRITERIOS

/**
 * Las actividades con que nace cada rectificadora, con su valor por unidad (pesos, sin IVA) y sus horas estándar por
 * unidad: el rectificado de cilindros se cobra por cilindro, la prueba hidráulica de culata también (una culata de
 * seis cilindros es más trabajo que una de cuatro), el armado de culata por culata. Los de terceros no tienen precio:
 * se escribe al cotizar. Cada taller ajusta las suyas y crea otras.
 *
 * `pieza` y `paso` arman la ruta: las actividades de una pieza se hacen de paso menor a mayor (el mismo paso, a la vez).
 * Lo de `motor` es de toda la OT: el desarme va antes que todo y el armado y el control final, después de todas las
 * piezas. `tipico` marca lo que trae el desglose de la cotización; quien cotiza quita lo que no corresponda.
 */
export const TRABAJOS_INICIALES: { codigo: string; nombre: string; seccion: ClaveSeccion; pieza: Pieza; paso: number; tipico: boolean; criterio: Criterio; unidad: string; precio: number | null; horas: number }[] = [
  { codigo: 'D-01', nombre: 'Desarme y lavado de motor', seccion: 'diagnostico', pieza: 'motor', paso: 10, tipico: true, criterio: 'fixed', unidad: 'motor', precio: 120_000, horas: 4 },
  { codigo: 'D-02', nombre: 'Medición y metrología (informe)', seccion: 'diagnostico', pieza: 'motor', paso: 20, tipico: true, criterio: 'fixed', unidad: 'motor', precio: 60_000, horas: 2 },
  { codigo: 'D-03', nombre: 'Prueba de fisuras (magnaflux)', seccion: 'diagnostico', pieza: 'motor', paso: 30, tipico: false, criterio: 'fixed', unidad: 'pieza', precio: 45_000, horas: 1 },
  { codigo: 'D-04', nombre: 'Prueba hidráulica de culata', seccion: 'diagnostico', pieza: 'culata', paso: 30, tipico: true, criterio: 'per_cylinder', unidad: 'cilindro', precio: 10_000, horas: 0.25 },
  { codigo: 'T-01', nombre: 'Soldadura de culata de aluminio', seccion: 'terceros', pieza: 'culata', paso: 110, tipico: false, criterio: 'per_head', unidad: 'culata', precio: null, horas: 0 },
  { codigo: 'C-01', nombre: 'Cepillado de culata', seccion: 'culatas', pieza: 'culata', paso: 120, tipico: true, criterio: 'per_head', unidad: 'culata', precio: 55_000, horas: 1.5 },
  { codigo: 'C-04', nombre: 'Cambio de guías de válvula', seccion: 'culatas', pieza: 'culata', paso: 130, tipico: false, criterio: 'per_valve', unidad: 'válvula', precio: 9_000, horas: 0.3 },
  { codigo: 'C-05', nombre: 'Cambio de asientos de válvula', seccion: 'culatas', pieza: 'culata', paso: 140, tipico: false, criterio: 'per_valve', unidad: 'válvula', precio: 15_000, horas: 0.5 },
  { codigo: 'C-02', nombre: 'Rectificado de asientos de válvula', seccion: 'culatas', pieza: 'culata', paso: 150, tipico: true, criterio: 'per_valve', unidad: 'válvula', precio: 8_000, horas: 0.25 },
  { codigo: 'C-03', nombre: 'Rectificado de válvulas', seccion: 'culatas', pieza: 'culata', paso: 150, tipico: true, criterio: 'per_valve', unidad: 'válvula', precio: 6_000, horas: 0.2 },
  { codigo: 'C-06', nombre: 'Armado de culata', seccion: 'culatas', pieza: 'culata', paso: 160, tipico: true, criterio: 'per_head', unidad: 'culata', precio: 50_000, horas: 2 },
  { codigo: 'B-05', nombre: 'Lineado de bancada', seccion: 'block', pieza: 'block', paso: 110, tipico: false, criterio: 'fixed', unidad: 'block', precio: 150_000, horas: 3 },
  { codigo: 'B-03', nombre: 'Encamisado de cilindro', seccion: 'block', pieza: 'block', paso: 120, tipico: false, criterio: 'per_cylinder', unidad: 'cilindro', precio: 45_000, horas: 1.5 },
  { codigo: 'B-04', nombre: 'Cepillado de block', seccion: 'block', pieza: 'block', paso: 130, tipico: true, criterio: 'fixed', unidad: 'block', precio: 70_000, horas: 2 },
  { codigo: 'B-01', nombre: 'Rectificado de cilindros', seccion: 'block', pieza: 'block', paso: 140, tipico: true, criterio: 'per_cylinder', unidad: 'cilindro', precio: 22_000, horas: 0.75 },
  { codigo: 'B-02', nombre: 'Bruñido de cilindros', seccion: 'block', pieza: 'block', paso: 150, tipico: true, criterio: 'per_cylinder', unidad: 'cilindro', precio: 12_000, horas: 0.4 },
  { codigo: 'B-06', nombre: 'Cambio de bujes de árbol de levas', seccion: 'block', pieza: 'block', paso: 160, tipico: false, criterio: 'fixed', unidad: 'juego', precio: 60_000, horas: 2 },
  { codigo: 'G-04', nombre: 'Enderezado de cigüeñal', seccion: 'cigueñal', pieza: 'cigüeñal', paso: 110, tipico: false, criterio: 'fixed', unidad: 'cigüeñal', precio: 90_000, horas: 2 },
  { codigo: 'T-03', nombre: 'Metalizado de muñones', seccion: 'terceros', pieza: 'cigüeñal', paso: 120, tipico: false, criterio: 'fixed', unidad: 'cigüeñal', precio: null, horas: 0 },
  { codigo: 'G-01', nombre: 'Rectificado de cigüeñal', seccion: 'cigueñal', pieza: 'cigüeñal', paso: 130, tipico: true, criterio: 'fixed', unidad: 'cigüeñal', precio: 120_000, horas: 3 },
  { codigo: 'T-02', nombre: 'Nitrurado de cigüeñal', seccion: 'terceros', pieza: 'cigüeñal', paso: 140, tipico: false, criterio: 'fixed', unidad: 'cigüeñal', precio: null, horas: 0 },
  { codigo: 'G-02', nombre: 'Pulido de cigüeñal', seccion: 'cigueñal', pieza: 'cigüeñal', paso: 150, tipico: true, criterio: 'fixed', unidad: 'cigüeñal', precio: 45_000, horas: 1 },
  { codigo: 'G-03', nombre: 'Balanceo de cigüeñal', seccion: 'cigueñal', pieza: 'cigüeñal', paso: 160, tipico: false, criterio: 'fixed', unidad: 'cigüeñal', precio: 80_000, horas: 2 },
  { codigo: 'G-06', nombre: 'Cambio de bujes de biela', seccion: 'cigueñal', pieza: 'bielas', paso: 110, tipico: false, criterio: 'per_rod', unidad: 'biela', precio: 12_000, horas: 0.4 },
  { codigo: 'G-05', nombre: 'Rectificado de bielas', seccion: 'cigueñal', pieza: 'bielas', paso: 120, tipico: true, criterio: 'per_rod', unidad: 'biela', precio: 18_000, horas: 0.5 },
  { codigo: 'A-02', nombre: 'Armado de block (medio motor)', seccion: 'armado', pieza: 'motor', paso: 200, tipico: false, criterio: 'per_cylinder', unidad: 'cilindro', precio: 45_000, horas: 1.5 },
  { codigo: 'A-01', nombre: 'Armado de motor completo', seccion: 'armado', pieza: 'motor', paso: 210, tipico: true, criterio: 'per_cylinder', unidad: 'cilindro', precio: 90_000, horas: 3 },
  { codigo: 'A-03', nombre: 'Pintura de motor', seccion: 'armado', pieza: 'motor', paso: 220, tipico: true, criterio: 'fixed', unidad: 'motor', precio: 40_000, horas: 1.5 },
  { codigo: 'Q-01', nombre: 'Control final y prueba de presión de aceite', seccion: 'calidad', pieza: 'motor', paso: 300, tipico: true, criterio: 'fixed', unidad: 'motor', precio: 35_000, horas: 1 },
]

/** Lo que entra a la rectificadora: un motor completo o piezas sueltas. */
export const PIEZAS = { motor: 'Motor completo', culata: 'Culata', block: 'Block', cigüeñal: 'Cigüeñal', bielas: 'Bielas', árbol: 'Árbol de levas', otra: 'Otra pieza' } as const
export type Pieza = keyof typeof PIEZAS
/** Las piezas que se trabajan por separado después del desarme, en el orden en que se muestran. */
export const PIEZAS_SUELTAS: Pieza[] = ['culata', 'block', 'cigüeñal', 'bielas', 'árbol', 'otra']

export const ESTADOS_OT = {
  received: 'Recibida',
  diagnosis: 'En diagnóstico',
  waiting_approval: 'Esperando aprobación',
  in_progress: 'En taller',
  quality: 'Control de calidad',
  ready: 'Lista para entregar',
  delivered: 'Entregada',
  cancelled: 'Anulada',
} as const
export type EstadoOt = keyof typeof ESTADOS_OT
/** Las que siguen en el taller. */
export const OT_ABIERTAS: EstadoOt[] = ['received', 'diagnosis', 'waiting_approval', 'in_progress', 'quality', 'ready']

export const ESTADOS_TAREA = { pending: 'Por hacer', in_progress: 'En proceso', done: 'Terminada' } as const
export type EstadoTarea = keyof typeof ESTADOS_TAREA

/** Por qué se detiene un trabajo. Detenido, sale de la cola de lo que se puede hacer y queda a la vista con su motivo. */
export const MOTIVOS_DETENCION = { parts: 'Faltan repuestos', customer: 'Falta respuesta del cliente', third_party: 'Está donde un tercero', other: 'Otro motivo' } as const
export type MotivoDetencion = keyof typeof MOTIVOS_DETENCION

/** Dónde está un trabajo en su ruta: lo que se ve en el tablero. */
export const SITUACIONES = { in_progress: 'En proceso', available: 'Para hacer', waiting: 'Espera su turno', held: 'Detenido', done: 'Terminado' } as const
export type Situacion = keyof typeof SITUACIONES

export const PRIORIDADES_OT = { normal: 'Normal', urgent: 'Urgente' } as const
export type PrioridadOt = keyof typeof PRIORIDADES_OT

export type DatosEstadoOt = {
  anulada: boolean
  entregada: boolean
  calidadAprobada: boolean
  /** `diagnostico`: es de la sección de recepción y diagnóstico. */
  tareas: { diagnostico: boolean; estado: EstadoTarea }[]
  /** El estado de la cotización vigente de la OT, si tiene. */
  cotizacion: 'draft' | 'sent' | 'accepted' | 'rejected' | 'cancelled' | null
}

/**
 * El estado de una OT no se marca a mano: sale de lo que pasó. Así nunca dice «en taller» con todo terminado, ni
 * «esperando aprobación» con la cotización ya aceptada. Solo la aprobación de calidad, la entrega y la anulación las
 * marca una persona.
 */
export function estadoDeOt(d: DatosEstadoOt): EstadoOt {
  if (d.anulada) return 'cancelled'
  if (d.entregada) return 'delivered'
  if (d.calidadAprobada) return 'ready'
  const trabajos = d.tareas.filter((t) => !t.diagnostico)
  if (trabajos.length) return trabajos.every((t) => t.estado === 'done') ? 'quality' : 'in_progress'
  if (d.cotizacion === 'sent') return 'waiting_approval'
  if (d.tareas.some((t) => t.estado !== 'pending')) return 'diagnosis'
  return 'received'
}

/** El avance: horas estándar terminadas sobre el total (sin horas estándar, cada tarea pesa lo mismo). */
export function avanceDeOt(tareas: { estado: EstadoTarea; minutos: number }[]): number {
  if (!tareas.length) return 0
  const peso = (t: { minutos: number }) => t.minutos || 30
  const total = tareas.reduce((s, t) => s + peso(t), 0)
  const hecho = tareas.reduce((s, t) => s + (t.estado === 'done' ? peso(t) : t.estado === 'in_progress' ? peso(t) / 2 : 0), 0)
  return hecho / total
}

/** Atrasada: pasó la entrega comprometida sin entregar. Por vencer: faltan dos días o menos. */
export function plazoDeOt(entrega: string | null, estado: EstadoOt, hoy: string): 'atrasada' | 'por_vencer' | null {
  if (!entrega || estado === 'delivered' || estado === 'cancelled') return null
  if (entrega < hoy) return 'atrasada'
  const dias = (Date.parse(entrega) - Date.parse(hoy)) / 86_400_000
  return dias <= 2 ? 'por_vencer' : null
}

/** Un trabajo de una OT visto en su ruta. */
export type TrabajoEnRuta = { id: string; pieza: Pieza; paso: number; estado: EstadoTarea; detenido: boolean; adelantado: boolean }

/**
 * Lo que falta terminar en la OT antes de empezar `t`. Cada pieza sigue su ruta: un trabajo espera a los de paso menor
 * de su misma pieza y a los de toda la OT (el desarme, antes que todo). Un trabajo de toda la OT (el armado, el
 * control final) espera a todos los de paso menor, de todas las piezas.
 */
export function anteriores<T extends TrabajoEnRuta>(t: TrabajoEnRuta, deLaOt: T[]): T[] {
  return deLaOt.filter((u) => u.id !== t.id && u.estado !== 'done' && u.paso < t.paso && (t.pieza === 'motor' || u.pieza === 'motor' || u.pieza === t.pieza))
}

/** Detenido manda; después, lo que está en proceso; lo que espera lo anterior no se puede empezar, salvo adelantado. */
export function situacionDe(t: TrabajoEnRuta, deLaOt: TrabajoEnRuta[]): Situacion {
  if (t.estado === 'done') return 'done'
  if (t.detenido) return 'held'
  if (t.estado === 'in_progress') return 'in_progress'
  if (t.adelantado) return 'available'
  return anteriores(t, deLaOt).length ? 'waiting' : 'available'
}

/** Cómo se agrupan los trabajos de una OT: el diagnóstico, cada pieza, y el armado y control de toda la OT. */
export type GrupoDeOt = 'diagnostico' | Pieza
const ORDEN_GRUPOS: GrupoDeOt[] = ['diagnostico', ...PIEZAS_SUELTAS, 'motor']
export const grupoDe = (t: { diagnostico: boolean; pieza: Pieza }): GrupoDeOt => (t.diagnostico ? 'diagnostico' : t.pieza)
export const nombreDeGrupo = (g: GrupoDeOt) => (g === 'diagnostico' ? 'Recepción y diagnóstico' : g === 'motor' ? 'Armado y control' : PIEZAS[g])
export const ordenDeGrupo = (g: GrupoDeOt) => ORDEN_GRUPOS.indexOf(g)

/**
 * Cómo va cada pieza de una OT: lo que se contesta en el mesón («la culata está lista, el block espera pistones»).
 * La situación de la pieza es la del trabajo que la tiene ocupada: detenido, en proceso, para hacer o esperando.
 */
export function piezasDeOt<T extends TrabajoEnRuta & { diagnostico: boolean; minutos: number; situacion: Situacion }>(tareas: T[]) {
  const grupos = new Map<GrupoDeOt, T[]>()
  for (const t of tareas) grupos.set(grupoDe(t), [...(grupos.get(grupoDe(t)) ?? []), t])
  return ORDEN_GRUPOS.filter((g) => grupos.has(g)).map((g) => {
    const lista = grupos.get(g)!
    const primera = (s: Situacion) => lista.find((t) => t.situacion === s)
    const actual = primera('held') ?? primera('in_progress') ?? primera('available') ?? primera('waiting') ?? null
    return {
      clave: g,
      nombre: nombreDeGrupo(g),
      avance: avanceDeOt(lista),
      total: lista.length,
      hechas: lista.filter((t) => t.estado === 'done').length,
      situacion: (actual?.situacion ?? 'done') as Situacion,
      actual,
    }
  })
}

/**
 * A quién va un trabajo nuevo: a uno de los especialistas de su actividad. La pieza no cambia de manos: si alguien ya
 * tiene otro trabajo de la misma pieza en la OT y también hace esta actividad, va a esa persona (quien cepilló la
 * culata le rectifica los asientos). Si no, al especialista con menos horas pendientes (empate: por nombre). Una
 * actividad sin especialistas queda sin asignar para el jefe de taller.
 */
export function responsableDe(t: { pieza: Pieza }, deLaOt: { pieza: Pieza; asignado: string | null }[], especialistas: { id: string; nombre: string; minutos: number }[]): string | null {
  const conLaPieza = deLaOt.find((u) => u.pieza === t.pieza && u.asignado && especialistas.some((e) => e.id === u.asignado))
  if (conLaPieza) return conLaPieza.asignado
  const [menos] = [...especialistas].sort((a, b) => a.minutos - b.minutos || a.nombre.localeCompare(b.nombre, 'es'))
  return menos?.id ?? null
}

/** Lo que se sabe del motor para contar las actividades. */
export type Motor = { cilindros: number; valvulasPorCilindro: number; culatas: number }
/** Mientras no se sabe: lo más común en el taller. */
export const MOTOR_POR_OMISION: Motor = { cilindros: 4, valvulasPorCilindro: 2, culatas: 1 }
export const CILINDROS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16]

/** Cuántas unidades lleva una actividad en este motor: 6 cilindros, 24 válvulas, 6 bielas, 1 culata o una vez. */
export function cantidadSegun(criterio: Criterio, m: Motor): number {
  if (criterio === 'per_cylinder' || criterio === 'per_rod') return m.cilindros
  if (criterio === 'per_valve') return m.cilindros * m.valvulasPorCilindro
  if (criterio === 'per_head') return m.culatas
  return 1
}

/** La unidad con que se lee el valor («$22.000 por cilindro»): sale del criterio; si es una vez, de la pieza. */
export function unidadDe(criterio: Criterio, pieza: Pieza): string {
  if (criterio === 'per_cylinder') return 'cilindro'
  if (criterio === 'per_valve') return 'válvula'
  if (criterio === 'per_rod') return 'biela'
  if (criterio === 'per_head') return 'culata'
  return pieza === 'bielas' ? 'juego' : pieza === 'otra' ? 'pieza' : PIEZAS[pieza].toLowerCase().replace(' completo', '')
}

const PLURAL: Record<Exclude<Criterio, 'fixed'>, string> = { per_cylinder: 'cilindros', per_valve: 'válvulas', per_rod: 'bielas', per_head: 'culatas' }

/** El nombre de un trabajo en la OT, con su cantidad: «Rectificado de cilindros (6 cilindros)», «Pintura de motor». */
export function nombreDeTarea(nombre: string, cantidad: number, criterio: Criterio | null | undefined) {
  if (cantidad === 1) return nombre
  return criterio && criterio !== 'fixed' ? `${nombre} (${cantidad} ${PLURAL[criterio]})` : `${nombre} ×${cantidad}`
}

/** La cola en días de trabajo: las horas por hacer repartidas entre su gente, a 8 horas por persona. */
export const diasDeCola = (minutos: number, personas: number) => (personas ? minutos / 60 / (personas * 8) : null)
