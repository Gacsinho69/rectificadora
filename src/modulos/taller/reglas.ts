// Cómo trabaja una rectificadora, sin servidor: las pantallas importan esto igual.
//
// El recorrido de un motor (o de sus piezas) por el taller:
// 1. Recepción: llega el motor o las piezas; se anota cliente, motor, piezas, falla y la entrega comprometida. Nace la OT
//    con sus trabajos de diagnóstico (desarme, lavado y medición).
// 2. Diagnóstico: con lo que se midió se arma la cotización.
// 3. Aprobación: el cliente acepta y la OT se llena con los trabajos cotizados, cada uno en su sección.
// 4. Taller: cada sección (culatas, block, cigüeñal y bielas, armado…) trabaja su cola; el jefe de taller asigna.
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

/**
 * La lista de trabajos con precio con que nace cada rectificadora (pesos, sin IVA). Cada taller ajusta sus precios. Un
 * trabajo «por unidad» se cobra por cilindro, válvula, guía o biela; los de terceros no tienen precio: se escribe al cotizar.
 */
export const TRABAJOS_INICIALES: { codigo: string; nombre: string; seccion: ClaveSeccion; unidad: string; precio: number | null; horas: number }[] = [
  { codigo: 'D-01', nombre: 'Desarme y lavado de motor', seccion: 'diagnostico', unidad: 'motor', precio: 120_000, horas: 4 },
  { codigo: 'D-02', nombre: 'Medición y metrología (informe)', seccion: 'diagnostico', unidad: 'motor', precio: 60_000, horas: 2 },
  { codigo: 'D-03', nombre: 'Prueba de fisuras (magnaflux)', seccion: 'diagnostico', unidad: 'pieza', precio: 45_000, horas: 1 },
  { codigo: 'D-04', nombre: 'Prueba hidrostática de culata', seccion: 'diagnostico', unidad: 'culata', precio: 40_000, horas: 1 },
  { codigo: 'C-01', nombre: 'Cepillado de culata', seccion: 'culatas', unidad: 'culata', precio: 55_000, horas: 1.5 },
  { codigo: 'C-02', nombre: 'Rectificado de asientos de válvula', seccion: 'culatas', unidad: 'asiento', precio: 8_000, horas: 0.25 },
  { codigo: 'C-03', nombre: 'Rectificado de válvulas', seccion: 'culatas', unidad: 'válvula', precio: 6_000, horas: 0.2 },
  { codigo: 'C-04', nombre: 'Cambio de guías de válvula', seccion: 'culatas', unidad: 'guía', precio: 9_000, horas: 0.3 },
  { codigo: 'C-05', nombre: 'Cambio de asientos de válvula', seccion: 'culatas', unidad: 'asiento', precio: 15_000, horas: 0.5 },
  { codigo: 'C-06', nombre: 'Armado de culata', seccion: 'culatas', unidad: 'culata', precio: 50_000, horas: 2 },
  { codigo: 'B-01', nombre: 'Rectificado de cilindros', seccion: 'block', unidad: 'cilindro', precio: 22_000, horas: 0.75 },
  { codigo: 'B-02', nombre: 'Bruñido de cilindros', seccion: 'block', unidad: 'cilindro', precio: 12_000, horas: 0.4 },
  { codigo: 'B-03', nombre: 'Encamisado de cilindro', seccion: 'block', unidad: 'cilindro', precio: 45_000, horas: 1.5 },
  { codigo: 'B-04', nombre: 'Cepillado de block', seccion: 'block', unidad: 'block', precio: 70_000, horas: 2 },
  { codigo: 'B-05', nombre: 'Lineado de bancada', seccion: 'block', unidad: 'block', precio: 150_000, horas: 3 },
  { codigo: 'B-06', nombre: 'Cambio de bujes de árbol de levas', seccion: 'block', unidad: 'juego', precio: 60_000, horas: 2 },
  { codigo: 'G-01', nombre: 'Rectificado de cigüeñal', seccion: 'cigueñal', unidad: 'cigüeñal', precio: 120_000, horas: 3 },
  { codigo: 'G-02', nombre: 'Pulido de cigüeñal', seccion: 'cigueñal', unidad: 'cigüeñal', precio: 45_000, horas: 1 },
  { codigo: 'G-03', nombre: 'Balanceo de cigüeñal', seccion: 'cigueñal', unidad: 'cigüeñal', precio: 80_000, horas: 2 },
  { codigo: 'G-04', nombre: 'Enderezado de cigüeñal', seccion: 'cigueñal', unidad: 'cigüeñal', precio: 90_000, horas: 2 },
  { codigo: 'G-05', nombre: 'Rectificado de bielas', seccion: 'cigueñal', unidad: 'biela', precio: 18_000, horas: 0.5 },
  { codigo: 'G-06', nombre: 'Cambio de bujes de biela', seccion: 'cigueñal', unidad: 'biela', precio: 12_000, horas: 0.4 },
  { codigo: 'A-01', nombre: 'Armado de motor completo', seccion: 'armado', unidad: 'motor', precio: 350_000, horas: 12 },
  { codigo: 'A-02', nombre: 'Armado de block (medio motor)', seccion: 'armado', unidad: 'motor', precio: 180_000, horas: 6 },
  { codigo: 'A-03', nombre: 'Pintura de motor', seccion: 'armado', unidad: 'motor', precio: 40_000, horas: 1.5 },
  { codigo: 'Q-01', nombre: 'Control final y prueba de presión de aceite', seccion: 'calidad', unidad: 'motor', precio: 35_000, horas: 1 },
  { codigo: 'T-01', nombre: 'Soldadura de culata de aluminio', seccion: 'terceros', unidad: 'culata', precio: null, horas: 0 },
  { codigo: 'T-02', nombre: 'Nitrurado de cigüeñal', seccion: 'terceros', unidad: 'cigüeñal', precio: null, horas: 0 },
  { codigo: 'T-03', nombre: 'Metalizado de muñones', seccion: 'terceros', unidad: 'cigüeñal', precio: null, horas: 0 },
]

/** Lo que entra a la rectificadora: un motor completo o piezas sueltas. */
export const PIEZAS = { motor: 'Motor completo', culata: 'Culata', block: 'Block', cigüeñal: 'Cigüeñal', bielas: 'Bielas', árbol: 'Árbol de levas', otra: 'Otra pieza' } as const
export type Pieza = keyof typeof PIEZAS

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
