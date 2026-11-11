// La cotización de una rectificadora: trabajos de la lista (con su sección), repuestos y otros cargos; descuento,
// IVA 19 % y total, en pesos. Sin servidor: la pantalla calcula igual que el servidor.
import { z } from 'zod'

export const IVA = 0.19

export const ESTADOS_COTIZACION = { draft: 'Borrador', sent: 'Enviada', accepted: 'Aceptada', rejected: 'Rechazada', cancelled: 'Anulada' } as const
export type EstadoCotizacion = keyof typeof ESTADOS_COTIZACION

export const TIPOS_LINEA = { trabajo: 'Trabajo', repuesto: 'Repuesto', otro: 'Otro cargo' } as const
export type TipoLinea = keyof typeof TIPOS_LINEA

export type Linea = {
  tipo: TipoLinea
  /** El trabajo de la lista del que viene (solo los trabajos). */
  trabajoId: string | null
  seccionId: string | null
  codigo: string | null
  descripcion: string
  cantidad: number
  /** Precio unitario sin IVA. Null: falta (un trabajo de terceros recién agregado); no se puede enviar así. */
  precio: number | null
  /** Horas estándar por unidad, para planificar el taller. */
  horas: number
}

export const lineaSchema = z.object({
  tipo: z.enum(['trabajo', 'repuesto', 'otro']),
  trabajoId: z.string().nullable(),
  seccionId: z.string().nullable(),
  codigo: z.string().max(40).nullable(),
  descripcion: z.string().trim().min(2, 'Cada línea necesita su descripción.').max(200),
  cantidad: z.number().positive('La cantidad debe ser mayor que cero.').max(10_000),
  precio: z.number().int().min(0).max(1_000_000_000).nullable(),
  horas: z.number().min(0).max(1000),
})

export const cotizacionSchema = z.object({
  clienteId: z.string({ error: 'Elige el cliente.' }).min(1, 'Elige el cliente.'),
  otId: z.string().nullable().optional(),
  motor: z.string().trim().min(2, 'Escribe el motor.').max(80),
  lineas: z.array(lineaSchema).max(200),
  descuento: z.number().int().min(0).max(100).default(0),
  notas: z.string().trim().max(1000).optional(),
})
export type DatosCotizacion = z.infer<typeof cotizacionSchema>

const redondear = (n: number) => Math.round(n)

/** Subtotal, descuento, neto, IVA y total. Cada línea se redondea al peso; las líneas sin precio no suman. */
export function totales(lineas: Pick<Linea, 'cantidad' | 'precio'>[], descuento: number) {
  const subtotal = lineas.reduce((s, l) => s + redondear(l.cantidad * (l.precio ?? 0)), 0)
  const rebaja = redondear((subtotal * descuento) / 100)
  const neto = subtotal - rebaja
  const iva = redondear(neto * IVA)
  return { subtotal, rebaja, neto, iva, total: neto + iva }
}

/** Lo que impide enviar una cotización, en palabras del taller. Vacío: se puede enviar. */
export function faltasParaEnviar(lineas: Pick<Linea, 'descripcion' | 'precio'>[]): string[] {
  const faltas: string[] = []
  if (!lineas.length) faltas.push('Agrega al menos una línea.')
  const sinPrecio = lineas.filter((l) => l.precio === null || l.precio === 0)
  if (sinPrecio.length) faltas.push(`Falta el precio de: ${sinPrecio.map((l) => l.descripcion).join(', ')}.`)
  return faltas
}

export const clienteSchema = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre del cliente.').max(120),
  rut: z.string().trim().max(20).optional(),
  contacto: z.string().trim().max(120).optional(),
  telefono: z.string().trim().max(40).optional(),
  correo: z.union([z.literal(''), z.email('El correo no es válido.')]).optional(),
})
