// Los repuestos de cada OT y sus compras, sin servidor: las pantallas importan esto igual.
//
// Cada repuesto cotizado y aceptado queda en su OT con quién lo consigue:
// - la rectificadora: queda «por pedir»; una orden de compra al proveedor lo pide, el chofer de compras lo compra y lo
//   retira, y se recibe en el taller (por partes, si no llegó todo);
// - el cliente: lo trae él; se recibe cuando llega.
// Mientras no llega, el trabajo que lo necesita (el armado, si no se dijo otro) espera repuestos.
//
// Los proveedores son una lista de cada rectificadora: se eligen al cotizar un repuesto y al emitir la orden de compra.
import { z } from 'zod'
import { rutValido } from '../../rut'

/**
 * Dos nombres son el mismo proveedor sin contar mayúsculas, tildes, espacios ni puntos (como en el ERP de Baufer):
 * «Repuestos Diésel Sur» y «repuestos diesel sur» no se repiten en la lista.
 */
export const claveDeProveedor = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

export const proveedorSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Escribe el nombre del proveedor.')
    .max(120)
    .refine((v) => claveDeProveedor(v).length >= 2, 'Escribe el nombre del proveedor.'),
  rut: z
    .string()
    .trim()
    .max(20)
    .refine((v) => !v || rutValido(v), 'El RUT no es válido: revisa el dígito verificador.')
    .optional(),
  contacto: z.string().trim().max(120).optional(),
  telefono: z.string().trim().max(40).optional(),
  correo: z.union([z.literal(''), z.email('El correo no es válido.')]).optional(),
  direccion: z.string().trim().max(200).optional(),
  nota: z.string().trim().max(500).optional(),
  activo: z.boolean().optional(),
})
export type DatosProveedor = z.infer<typeof proveedorSchema>

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

/** Lo que identifica un repuesto para pedir el correcto: «0,50 · Mahle · 228-0001». Vacío si no se dijo nada. */
export const referenciaDe = (r: { medida?: string | null; marca?: string | null; codigo?: string | null }) => [r.medida, r.marca, r.codigo].filter(Boolean).join(' · ')

/**
 * Lo que hay que pedir, por proveedor (el que se cotizó) y, dentro, lo que la OT necesita antes: lo atrasado, lo urgente
 * y lo que se entrega antes. Lo sin proveedor va al final.
 */
export function porProveedor<R extends { id: string; proveedorId: string | null; proveedor: string | null; costo: number | null; cantidad: number; ot: { entrega: string | null; prioridad: string; plazo: string | null } }>(repuestos: R[]) {
  const grupos = new Map<string, { clave: string; proveedor: string | null; repuestos: R[]; costo: number }>()
  for (const r of repuestos) {
    const clave = r.proveedorId ?? r.proveedor ?? ''
    const g = grupos.get(clave) ?? { clave, proveedor: r.proveedor, repuestos: [], costo: 0 }
    g.repuestos.push(r)
    g.costo += Math.round((r.costo ?? 0) * r.cantidad)
    grupos.set(clave, g)
  }
  const urgencia = (r: R) => (r.ot.plazo === 'atrasada' ? 0 : r.ot.prioridad === 'urgent' ? 1 : 2)
  for (const g of grupos.values()) g.repuestos.sort((a, b) => urgencia(a) - urgencia(b) || (a.ot.entrega ?? '9999').localeCompare(b.ot.entrega ?? '9999'))
  return [...grupos.values()].sort((a, b) => Number(!a.proveedor) - Number(!b.proveedor) || (a.proveedor ?? '').localeCompare(b.proveedor ?? '', 'es'))
}

/**
 * El trabajo que espera un repuesto: el de la actividad que dice la cotización; si no dice, el armado (lo primero de
 * toda la OT después de las piezas); si no hay armado, lo último que queda por hacer.
 */
export function trabajoQueLoNecesita<T extends { id: string; codigo: string | null; pieza: string; paso: number; diagnostico: boolean; estado: string }>(tareas: T[], necesita?: string | null): T | null {
  const porHacer = tareas.filter((t) => t.estado !== 'done').sort((a, b) => a.paso - b.paso)
  const dicho = necesita ? porHacer.find((t) => t.codigo === necesita) : undefined
  return dicho ?? porHacer.find((t) => t.pieza === 'motor' && !t.diagnostico) ?? porHacer.at(-1) ?? null
}
