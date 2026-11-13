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

/**
 * El costo real contra lo cotizado, por proveedor. Solo se compara lo que tiene costo real y costo cotizado; lo demás
 * se cuenta como «por anotar». La diferencia es real menos cotizado (positiva: se pagó más de lo cotizado).
 */
export function comparacionDeCostos(lineas: { proveedor: string | null; cantidad: number; costo: number | null; costoReal: number | null }[]) {
  const grupos = new Map<string, { proveedor: string; lineas: number; porAnotar: number; cotizado: number; real: number }>()
  for (const l of lineas) {
    const clave = l.proveedor ?? 'Sin proveedor'
    const g = grupos.get(clave) ?? { proveedor: clave, lineas: 0, porAnotar: 0, cotizado: 0, real: 0 }
    g.lineas++
    if (l.costoReal === null || l.costo === null) g.porAnotar++
    else {
      g.cotizado += Math.round(l.costo * l.cantidad)
      g.real += Math.round(l.costoReal * l.cantidad)
    }
    grupos.set(clave, g)
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, diferencia: g.real - g.cotizado, fraccion: g.cotizado ? (g.real - g.cotizado) / g.cotizado : null }))
    .sort((a, b) => b.diferencia - a.diferencia || a.proveedor.localeCompare(b.proveedor, 'es'))
}

/** El margen de lo vendido sobre lo que costó: 0,25 es 25 %. Sin venta, no hay margen. */
export const margenDe = (vendido: number, costo: number) => (vendido > 0 ? (vendido - costo) / vendido : null)

/** Lo que guarda la bodega: insumos que se gastan en el taller y repuestos que se instalan en un motor. */
export const TIPOS_ARTICULO = { supply: 'Insumo', part: 'Repuesto' } as const
export type TipoArticulo = keyof typeof TIPOS_ARTICULO

/**
 * Los artículos de bodega que pueden servir para un repuesto por pedir, los más parecidos primero: el mismo número de
 * parte, o un nombre que contiene al otro. Solo los que alcanzan; de los insumos, solo los parecidos.
 */
export function candidatosDeBodega<A extends { nombre: string; codigo: string | null; stock: number; tipo: TipoArticulo; activo: boolean }>(articulos: A[], r: { descripcion: string; codigo: string | null; cantidad: number }) {
  const clave = (s: string) => claveDeProveedor(s)
  const puntos = (a: A) => (r.codigo && a.codigo && clave(a.codigo) === clave(r.codigo) ? 3 : clave(a.nombre).includes(clave(r.descripcion)) || clave(r.descripcion).includes(clave(a.nombre)) ? 2 : a.tipo === 'part' ? 1 : 0)
  return articulos
    .filter((a) => a.activo && a.stock >= r.cantidad)
    .map((a) => ({ a, p: puntos(a) }))
    .sort((x, y) => y.p - x.p || x.a.nombre.localeCompare(y.a.nombre, 'es'))
    .filter(({ a, p }) => a.tipo === 'part' || p >= 2)
    .map(({ a, p }) => ({ ...a, parecido: p >= 2 }))
}

/** Lo que entra y sale de la bodega. */
export const MOVIMIENTOS_INSUMO = { purchase: 'Compra', use: 'Consumo', adjust: 'Ajuste' } as const
export type TipoMovimiento = keyof typeof MOVIMIENTOS_INSUMO

/** Las unidades más comunes; se puede escribir otra. */
export const UNIDADES = ['unidad', 'litro', 'kilo', 'caja', 'juego', 'metro', 'tarro'] as const

/** Hay que pedir un insumo cuando queda su mínimo o menos (sin mínimo, nunca se avisa). */
export const bajoMinimo = (stock: number, minimo: number) => minimo > 0 && stock <= minimo

/** Cuánto conviene pedir: hasta tener el doble del mínimo, descontando lo que ya viene en camino. */
export const cantidadSugerida = (stock: number, minimo: number, porLlegar = 0) => Math.max(1, Math.ceil(minimo * 2 - stock - porLlegar))

export const insumoSchema = z.object({
  nombre: z.string({ error: 'Escribe el insumo.' }).trim().min(2, 'Escribe el insumo.').max(120),
  unidad: z.string({ error: 'Escribe la unidad.' }).trim().min(1, 'Escribe la unidad.').max(20),
  minimo: z.number().min(0, 'El mínimo no puede ser negativo.').max(1_000_000).default(0),
  marca: z.string().trim().max(60).optional(),
  codigo: z.string().trim().max(60).optional(),
  proveedorId: z.string().nullable().optional(),
  costo: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  nota: z.string().trim().max(500).optional(),
  activo: z.boolean().optional(),
  tipo: z.enum(['supply', 'part']).default('supply'),
})
export type DatosInsumo = z.infer<typeof insumoSchema>

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
