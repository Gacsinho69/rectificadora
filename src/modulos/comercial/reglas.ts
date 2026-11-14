// La cotización de una rectificadora: actividades de la lista (con su sección y su pieza), repuestos y otros cargos;
// descuento, IVA 19 % y total, en pesos. Las actividades se cuentan con los datos del motor: el rectificado de
// cilindros de un motor de 6 cilindros va por 6. Cada repuesto dice quién lo compra: la rectificadora (a su proveedor,
// a un costo) o el cliente, que lo trae y no se le cobra. Sin servidor: la pantalla calcula igual que el servidor.
import { z } from 'zod'
import { rutValido } from '../../rut'
import { QUIEN_COMPRA, type QuienCompra } from '../compras/reglas'
import { cantidadSegun, type Criterio, CRITERIOS, type Motor, ordenDeGrupo, type Pieza, type PiezaPropia } from '../taller/reglas'

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
  /** La pieza a la que va (la de la actividad, salvo que se cambie): ordena la cotización y la ruta en el taller. */
  pieza?: Pieza | null
  /** Cómo se cuenta: si cambian los cilindros, las líneas por cilindro se cuentan de nuevo. */
  criterio?: Criterio | null
  /** Repuestos: quién lo compra. Lo que trae el cliente no se cobra. */
  compra?: QuienCompra | null
  /**
   * Repuestos que compra la rectificadora: a quién (un proveedor de su lista; el nombre lo pone el servidor al guardar)
   * y a cuánto por unidad. Interno: el cliente ve el precio.
   */
  proveedorId?: string | null
  proveedor?: string | null
  costo?: number | null
  /** Repuestos: el código de la actividad cotizada que no puede empezar sin él. Vacío: el armado. */
  necesita?: string | null
  /** Repuestos: la medida (STD, 0,25, 0,50…), la marca y el número de parte, para pedir el correcto. */
  medida?: string | null
  marca?: string | null
  numeroParte?: string | null
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
  // Una de las de siempre o una propia del taller (su id): la ruta revisa que sea de la rectificadora.
  pieza: z.string().max(40).nullable().optional(),
  criterio: z.enum(Object.keys(CRITERIOS) as [Criterio, ...Criterio[]]).nullable().optional(),
  compra: z.enum(Object.keys(QUIEN_COMPRA) as [QuienCompra, ...QuienCompra[]]).nullable().optional(),
  proveedorId: z.string().max(40).nullable().optional(),
  proveedor: z.string().trim().max(120).nullable().optional(),
  costo: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  necesita: z.string().max(40).nullable().optional(),
  medida: z.string().trim().max(40).nullable().optional(),
  marca: z.string().trim().max(60).nullable().optional(),
  numeroParte: z.string().trim().max(60).nullable().optional(),
})

export const cotizacionSchema = z.object({
  clienteId: z.string({ error: 'Elige el cliente.' }).min(1, 'Elige el cliente.'),
  otId: z.string().nullable().optional(),
  motor: z.string().trim().min(2, 'Escribe el motor.').max(80),
  cilindros: z.number().int().min(1).max(24).nullable().optional(),
  valvulasPorCilindro: z.number().int().min(1).max(6).nullable().optional(),
  culatas: z.number().int().min(1).max(24).nullable().optional(),
  lineas: z.array(lineaSchema).max(200),
  descuento: z.number().int().min(0).max(100).default(0),
  notas: z.string().trim().max(1000).optional(),
})
export type DatosCotizacion = z.infer<typeof cotizacionSchema>

const redondear = (n: number) => Math.round(n)

/** Lo que trae el cliente no se cobra: no suma ni necesita precio. */
export const loTraeElCliente = (l: { tipo?: TipoLinea; compra?: QuienCompra | null }) => l.tipo === 'repuesto' && l.compra === 'customer'

/** Subtotal, descuento, neto, IVA y total. Cada línea se redondea al peso; las sin precio y las que trae el cliente no suman. */
export function totales(lineas: (Pick<Linea, 'cantidad' | 'precio'> & Partial<Pick<Linea, 'tipo' | 'compra'>>)[], descuento: number) {
  const subtotal = lineas.filter((l) => !loTraeElCliente(l)).reduce((s, l) => s + redondear(l.cantidad * (l.precio ?? 0)), 0)
  const rebaja = redondear((subtotal * descuento) / 100)
  const neto = subtotal - rebaja
  const iva = redondear(neto * IVA)
  return { subtotal, rebaja, neto, iva, total: neto + iva }
}

/** Lo que impide enviar una cotización, en palabras del taller. Vacío: se puede enviar. */
export function faltasParaEnviar(lineas: (Pick<Linea, 'descripcion' | 'precio'> & Partial<Pick<Linea, 'tipo' | 'compra'>>)[]): string[] {
  const faltas: string[] = []
  if (!lineas.length) faltas.push('Agrega al menos una línea.')
  const sinPrecio = lineas.filter((l) => !loTraeElCliente(l) && (l.precio === null || l.precio === 0))
  if (sinPrecio.length) faltas.push(`Falta el precio de: ${sinPrecio.map((l) => l.descripcion.trim() || 'una línea sin nombre').join(', ')}.`)
  return faltas
}

export const clienteSchema = z.object({
  nombre: z.string().trim().min(2, 'Escribe el nombre del cliente.').max(120),
  rut: z
    .string()
    .trim()
    .max(20)
    .refine((v) => !v || rutValido(v), 'El RUT no es válido: revisa el dígito verificador.')
    .optional(),
  contacto: z.string().trim().max(120).optional(),
  telefono: z.string().trim().max(40).optional(),
  correo: z.union([z.literal(''), z.email('El correo no es válido.')]).optional(),
})

/** Una actividad de la lista, como la ve la cotización. */
export type ActividadDeLista = { id: string; seccionId: string; codigo: string; nombre: string; precio: number | null; horas: number; pieza: Pieza; paso: number; criterio: Criterio; tipico: boolean; activo: boolean }

/** La línea de una actividad, contada para este motor. */
export const lineaDe = (a: ActividadDeLista, m: Motor, pieza: Pieza = a.pieza): Linea => ({
  tipo: 'trabajo',
  trabajoId: a.id,
  seccionId: a.seccionId,
  codigo: a.codigo,
  descripcion: a.nombre,
  cantidad: cantidadSegun(a.criterio, m),
  precio: a.precio,
  horas: a.horas,
  pieza,
  criterio: a.criterio,
})

/**
 * El desglose por pieza: las actividades típicas de las piezas elegidas, contadas para este motor y en el orden de su
 * ruta (lo del motor completo: el desarme primero, el armado y el control al final). Lo que ya está no se repite.
 * Quien cotiza quita después lo que no corresponda.
 */
export function desglose(actividades: ActividadDeLista[], piezas: Pieza[], m: Motor, yaEstan: Linea[], diagnostico: Set<string>, propias: readonly PiezaPropia[] = []): Linea[] {
  const ya = new Set(yaEstan.map((l) => l.trabajoId).filter(Boolean))
  const orden = (a: ActividadDeLista) => (a.pieza === 'motor' ? (diagnostico.has(a.seccionId) ? -1 : 9999) : ordenDeGrupo(a.pieza, propias))
  return actividades
    .filter((a) => a.activo && a.tipico && piezas.includes(a.pieza) && !ya.has(a.id))
    .sort((a, b) => orden(a) - orden(b) || a.paso - b.paso || a.codigo.localeCompare(b.codigo))
    .map((a) => lineaDe(a, m))
}

/** Si cambian los datos del motor, las líneas por cilindro, válvula, biela o culata se cuentan de nuevo. */
export const recontar = (lineas: Linea[], m: Motor): Linea[] => lineas.map((l) => (l.criterio && l.criterio !== 'fixed' ? { ...l, cantidad: cantidadSegun(l.criterio, m) } : l))
