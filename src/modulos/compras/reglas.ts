// Los repuestos de cada OT y sus compras, sin servidor: las pantallas importan esto igual.
//
// Cada repuesto cotizado y aceptado queda en su OT con quién lo consigue:
// - la rectificadora: queda «por pedir»; una orden de compra al proveedor lo pide, el chofer de compras lo compra y lo
//   retira, y se recibe en el taller (por partes, si no llegó todo);
// - el cliente: lo trae él; se recibe cuando llega.
// Mientras no llega, el trabajo que lo necesita (el armado, si no se dijo otro) espera repuestos.

export const QUIEN_COMPRA = { shop: 'La rectificadora', customer: 'El cliente' } as const
export type QuienCompra = keyof typeof QUIEN_COMPRA

export const ESTADOS_REPUESTO = { pending: 'Por pedir', ordered: 'Pedido', received: 'Recibido', cancelled: 'Anulado' } as const
export type EstadoRepuesto = keyof typeof ESTADOS_REPUESTO
/** Lo que todavía no llega: hace esperar al trabajo que lo necesita. */
export const POR_LLEGAR: EstadoRepuesto[] = ['pending', 'ordered']

/** Cómo se dice el estado de un repuesto: el que trae el cliente no se pide, se espera. */
export const estadoDeRepuesto = (r: { compra: QuienCompra; estado: EstadoRepuesto }) => (r.compra === 'customer' && r.estado === 'pending' ? 'Lo trae el cliente' : ESTADOS_REPUESTO[r.estado])

export const ESTADOS_OC = { open: 'Por retirar', received: 'Recibida', cancelled: 'Anulada' } as const
export type EstadoOc = keyof typeof ESTADOS_OC

/**
 * El estado de una orden de compra sale de sus repuestos: por retirar mientras algo siga pedido; recibida cuando llegó
 * todo; anulada si se anuló o si no le queda nada (sus OT se anularon antes de que llegara algo).
 */
export function estadoDeOc(repuestos: { estado: EstadoRepuesto }[], anulada: boolean): EstadoOc {
  if (anulada) return 'cancelled'
  if (repuestos.some((r) => r.estado === 'ordered')) return 'open'
  return repuestos.some((r) => r.estado === 'received') ? 'received' : 'cancelled'
}

export const folioOc = (n: number) => `OC-${String(n).padStart(4, '0')}`

/**
 * El trabajo que espera un repuesto: el de la actividad que dice la cotización; si no dice, el armado (lo primero de
 * toda la OT después de las piezas); si no hay armado, lo último que queda por hacer.
 */
export function trabajoQueLoNecesita<T extends { id: string; codigo: string | null; pieza: string; paso: number; diagnostico: boolean; estado: string }>(tareas: T[], necesita?: string | null): T | null {
  const porHacer = tareas.filter((t) => t.estado !== 'done').sort((a, b) => a.paso - b.paso)
  const dicho = necesita ? porHacer.find((t) => t.codigo === necesita) : undefined
  return dicho ?? porHacer.find((t) => t.pieza === 'motor' && !t.diagnostico) ?? porHacer.at(-1) ?? null
}
