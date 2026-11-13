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

/**
 * Con qué taller nace una rectificadora nueva: las secciones y las actividades de la lista inicial que le sirven (un
 * taller de culatas no necesita block ni cigüeñal). Después cada una ajusta sus valores, agrega las suyas y apaga las
 * que no hace.
 */
export const PLANTILLAS_TALLER = {
  completa: {
    nombre: 'Rectificadora completa',
    detalle: 'Motor completo y piezas sueltas: culatas, block, cigüeñal y bielas, con armado, control final y trabajos de terceros.',
    secciones: SECCIONES_INICIALES.map((s) => s.clave),
    codigos: TRABAJOS_INICIALES.map((t) => t.codigo),
  },
  culatas: {
    nombre: 'Taller de culatas',
    detalle: 'Solo culatas: pruebas de fisuras e hidráulica, cepillado, guías, asientos, válvulas y armado. La soldadura, con un tercero.',
    secciones: ['diagnostico', 'culatas', 'terceros'],
    codigos: ['D-03', 'D-04', 'T-01', 'C-01', 'C-04', 'C-05', 'C-02', 'C-03', 'C-06'],
  },
  block: {
    nombre: 'Block, cigüeñal y bielas',
    detalle: 'Sin culatas: block, cigüeñal y bielas, armado de medio motor y control final. Metalizado y nitrurado, con terceros.',
    secciones: ['diagnostico', 'block', 'cigueñal', 'armado', 'calidad', 'terceros'],
    codigos: ['D-01', 'D-02', 'D-03', 'B-05', 'B-03', 'B-04', 'B-01', 'B-02', 'B-06', 'G-04', 'T-03', 'G-01', 'T-02', 'G-02', 'G-03', 'G-06', 'G-05', 'A-02', 'Q-01'],
  },
} as const satisfies Record<string, { nombre: string; detalle: string; secciones: readonly ClaveSeccion[]; codigos: readonly string[] }>
export type PlantillaTaller = keyof typeof PLANTILLAS_TALLER

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
export const SITUACIONES = { in_progress: 'En proceso', available: 'Para hacer', parts: 'Espera repuestos', machine: 'Máquina detenida', waiting: 'Espera su turno', held: 'Detenido', done: 'Terminado' } as const
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

/**
 * Un trabajo de una OT visto en su ruta. `faltanRepuestos`: cuántos de los repuestos que necesita no han llegado;
 * `sinMaquina`: cuántas de las máquinas que necesita están detenidas.
 */
export type TrabajoEnRuta = { id: string; pieza: Pieza; paso: number; estado: EstadoTarea; detenido: boolean; adelantado: boolean; faltanRepuestos?: number; sinMaquina?: number }

/**
 * Lo que falta terminar en la OT antes de empezar `t`. Cada pieza sigue su ruta: un trabajo espera a los de paso menor
 * de su misma pieza y a los de toda la OT (el desarme, antes que todo). Un trabajo de toda la OT (el armado, el
 * control final) espera a todos los de paso menor, de todas las piezas.
 */
export function anteriores<T extends TrabajoEnRuta>(t: TrabajoEnRuta, deLaOt: T[]): T[] {
  return deLaOt.filter((u) => u.id !== t.id && u.estado !== 'done' && u.paso < t.paso && (t.pieza === 'motor' || u.pieza === 'motor' || u.pieza === t.pieza))
}

/**
 * Detenido manda; después, lo que está en proceso. No se puede empezar lo que necesita una máquina detenida (ni
 * adelantándolo: sin máquina no se hace), lo que espera repuestos (se dice antes que la ruta: es lo que hay que ir a
 * buscar) ni lo que espera lo anterior de su ruta, salvo que el jefe de taller lo adelante.
 */
export function situacionDe(t: TrabajoEnRuta, deLaOt: TrabajoEnRuta[]): Situacion {
  if (t.estado === 'done') return 'done'
  if (t.detenido) return 'held'
  if (t.estado === 'in_progress') return 'in_progress'
  if (t.sinMaquina) return 'machine'
  if (t.adelantado) return 'available'
  if (t.faltanRepuestos) return 'parts'
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
 * La situación de la pieza es la del trabajo que la tiene ocupada: detenido, en proceso, para hacer o esperando
 * repuestos o su turno.
 */
export function piezasDeOt<T extends TrabajoEnRuta & { diagnostico: boolean; minutos: number; situacion: Situacion }>(tareas: T[]) {
  const grupos = new Map<GrupoDeOt, T[]>()
  for (const t of tareas) grupos.set(grupoDe(t), [...(grupos.get(grupoDe(t)) ?? []), t])
  return ORDEN_GRUPOS.filter((g) => grupos.has(g)).map((g) => {
    const lista = grupos.get(g)!
    const primera = (s: Situacion) => lista.find((t) => t.situacion === s)
    const actual = primera('held') ?? primera('in_progress') ?? primera('available') ?? primera('machine') ?? primera('parts') ?? primera('waiting') ?? null
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

/** El horario del taller: de 8 a 19 h, de lunes a sábado, en hora de Chile (UTC−3). Las horas reales se cuentan dentro de él. */
export const JORNADA = { desde: 8, hasta: 19, zona: -3 }

const HORA = 3_600_000

/** Las horas de jornada entre dos momentos: las de 8 a 19 de cada día, sin los domingos. */
export function horasDeJornada(desde: Date, hasta: Date): number {
  if (hasta <= desde) return 0
  const local = (d: Date) => new Date(d.getTime() + JORNADA.zona * HORA)
  let total = 0
  // Día por día, en hora local: lo que cae dentro del horario de ese día.
  const primero = local(desde)
  let dia = Date.UTC(primero.getUTCFullYear(), primero.getUTCMonth(), primero.getUTCDate())
  const fin = local(hasta).getTime()
  for (; dia <= fin; dia += 24 * HORA) {
    if (new Date(dia).getUTCDay() === 0) continue
    const abre = Math.max(dia + JORNADA.desde * HORA, local(desde).getTime())
    const cierra = Math.min(dia + JORNADA.hasta * HORA, fin)
    if (cierra > abre) total += (cierra - abre) / HORA
  }
  return total
}

/**
 * Las horas reales de un trabajo terminado: las de jornada entre que se empezó y se terminó, sin las que estuvo
 * detenido. Es una aproximación: si alguien hace dos trabajos a la vez, los dos cuentan.
 */
export function horasReales(inicio: Date, termino: Date, detenciones: { desde: Date; hasta: Date | null }[] = []): number {
  const detenido = detenciones.reduce((s, d) => {
    const desde = d.desde > inicio ? d.desde : inicio
    const hasta = d.hasta && d.hasta < termino ? d.hasta : termino
    return s + horasDeJornada(desde, hasta)
  }, 0)
  return Math.max(0, horasDeJornada(inicio, termino) - detenido)
}

/**
 * El rendimiento de un grupo de trabajos terminados (de una actividad o de una persona): cuántos, sus horas estándar
 * y reales, y cuánto toman de verdad contra lo estándar (1,2 = 20 % más). Con su hora real por unidad, para afinar la
 * hora estándar de una actividad.
 */
export function rendimientoDe(trabajos: { estandar: number; real: number; cantidad: number }[]) {
  const estandar = trabajos.reduce((s, t) => s + t.estandar, 0)
  const real = trabajos.reduce((s, t) => s + t.real, 0)
  const unidades = trabajos.reduce((s, t) => s + t.cantidad, 0)
  return { trabajos: trabajos.length, estandar, real, proporcion: estandar ? real / estandar : null, realPorUnidad: unidades ? real / unidades : null }
}

const DIA_MS = 86_400_000

/** La fecha en que se terminan `dias` de trabajo desde `hoy`, contando de lunes a sábado. */
export function fechaTrasDiasHabiles(hoy: string, dias: number): string {
  let fecha = Date.parse(`${hoy}T12:00:00Z`)
  for (let quedan = Math.max(1, Math.ceil(dias)); quedan > 0; ) {
    fecha += DIA_MS
    if (new Date(fecha).getUTCDay() !== 0) quedan--
  }
  return new Date(fecha).toISOString().slice(0, 10)
}

/**
 * Cuántos días de trabajo faltan para terminar. En cada sección de su ruta, un trabajo espera la cola de esa sección y
 * después hace lo suyo (sus horas, repartidas en las de su gente). Las piezas avanzan a la vez; lo de toda la OT (el
 * armado, el control) va después de la más lenta y de que lleguen los repuestos. El diagnóstico, si falta, va antes que
 * todo. Es una estimación: no sabe de urgencias ni de lo que se adelanta.
 */
export function diasParaTerminar(trabajos: { seccionId: string; pieza: Pieza; diagnostico: boolean; horas: number }[], colas: Map<string, { dias: number; horasPorDia: number }>, diasRepuestos = 0): number {
  const tramo = (lista: typeof trabajos) => {
    const porSeccion = new Map<string, number>()
    for (const t of lista) porSeccion.set(t.seccionId, (porSeccion.get(t.seccionId) ?? 0) + t.horas)
    return [...porSeccion].reduce((s, [seccion, horas]) => {
      const c = colas.get(seccion)
      return s + (c?.dias ?? 0) + horas / Math.max(c?.horasPorDia ?? 8, 1)
    }, 0)
  }
  const diagnostico = tramo(trabajos.filter((t) => t.diagnostico))
  const enPiezas = trabajos.filter((t) => !t.diagnostico && t.pieza !== 'motor')
  const masLenta = Math.max(0, ...[...new Set(enPiezas.map((t) => t.pieza))].map((p) => tramo(enPiezas.filter((t) => t.pieza === p))))
  const final = tramo(trabajos.filter((t) => !t.diagnostico && t.pieza === 'motor'))
  return diagnostico + Math.max(masLenta, diasRepuestos) + final
}
