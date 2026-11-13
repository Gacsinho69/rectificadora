// Lo que responde la API del sistema de la rectificadora, como lo ven las pantallas.
import type { EstadoCotizacion, Linea } from '../../comercial/reglas'
import type { EstadoOc, EstadoRepuesto, QuienCompra } from '../../compras/reglas'
import type { RolTenant } from '../../usuarios/reglas'
import type { Criterio, EstadoOt, EstadoTarea, GrupoDeOt, MotivoDetencion, Pieza, PrioridadOt, Situacion } from '../reglas'

export type Plazo = 'atrasada' | 'por_vencer' | null

export type FilaOt = {
  id: string
  numero: number
  cliente: string
  motor: string
  equipo?: string | null
  piezas?: Pieza[]
  estado: EstadoOt
  prioridad: PrioridadOt
  entrega: string | null
  creada: string
  plazo: Plazo
  avance?: number
  total?: number
  hechas?: number
  detenidas?: number
}

/** La carga de una sección: horas para hacer ahora, esperando su turno y detenidas, y los días de cola con su gente. */
export type CargaSeccion = {
  id: string
  nombre: string
  diagnostico: boolean
  gente: { id: string; nombre: string }[]
  trabajos: number
  enProceso: number
  ahora: number
  espera: number
  detenidas: number
  nDetenidas: number
  sinAsignar: number
  dias: number | null
}

export type CargaPersona = { id: string; nombre: string; rol: RolTenant; actividades: number; secciones: string[]; trabajos: number; enProceso: number; ahora: number; espera: number; detenidas: number; nDetenidas: number; sinAsignar: number }

export type Inicio = {
  cifras: { recibidas: number; esperando: number; enTaller: number; calidad: number; listas: number; atrasadas: number; porVencer: number; entregadasMes: number; detenidos: number; esperanRepuestos: number; esperanMaquina: number }
  urgentes: FilaOt[]
  carga: { seccionId: string; nombre: string; gente: number; enProceso: number; ahora: number; espera: number; detenidos: number; sinAsignar: number; dias: number | null }[]
  misTareas: { id: string; nombre: string; estado: EstadoTarea; situacion: Situacion; espera: string[]; faltan: string[]; maquinas: string[]; otId: string; ot: number; motor: string; entrega: string | null; seccion: string; pieza: Pieza }[]
  /** Las órdenes de compra que tiene que ir a buscar quien mira (el chofer de compras). */
  misRetiros: { id: string; numero: number; proveedor: string; direccion: string | null; telefono: string | null; llega: string | null; repuestos: { descripcion: string; medida: string | null; cantidad: number; ot: number }[] }[]
  comercial: { enviadasMes: number; cotizadoMes: number; aceptadasMes: number; aceptadoMes: number; pendientes: number; montoPendiente: number; tasaAceptacion: number | null } | null
}

export type Detencion = { motivo: MotivoDetencion; nota: string | null; desde: string; por: string | null }

export type Tarea = {
  id: string
  /** La actividad de la lista de la que viene: sus especialistas van primero al asignar. */
  actividadId: string | null
  nombre: string
  cantidad: number
  seccionId: string
  seccion: string
  diagnostico: boolean
  pieza: Pieza
  grupo: GrupoDeOt
  paso: number
  estado: EstadoTarea
  situacion: Situacion
  espera: string[]
  /** Los repuestos que necesita y no han llegado. */
  faltan: string[]
  /** Las máquinas que necesita y están detenidas. */
  maquinas: string[]
  detencion: Detencion | null
  adelantado: boolean
  horas: number
  asignadoId: string | null
  asignado: string | null
  inicio: string | null
  termino: string | null
  indicaciones: string | null
  resultado: string | null
}

/** La ficha de un trabajo, como la ve quien lo hace: sin montos. */
export type FichaTarea = {
  id: string
  nombre: string
  cantidad: number
  pieza: Pieza
  seccion: string
  estado: EstadoTarea
  situacion: Situacion
  espera: string[]
  faltan: string[]
  maquinas: string[]
  detencion: Detencion | null
  horas: number
  asignadoId: string | null
  asignado: string | null
  inicio: string | null
  termino: string | null
  indicaciones: string | null
  resultado: string | null
  ot: { id: string; numero: number; estado: EstadoOt; cliente: string; motor: string; numeroMotor: string | null; equipo: string | null; cilindros: number | null; valvulasPorCilindro: number | null; culatas: number | null; falla: string | null; entrega: string | null; prioridad: PrioridadOt; plazo: Plazo }
  anteriores: { id: string; nombre: string; resultado: string | null; quien: string | null; termino: string | null }[]
  repuestos: { id: string; descripcion: string; cantidad: number; medida: string | null; marca: string | null; codigo: string | null; compra: QuienCompra; estado: EstadoRepuesto; recibido: string | null }[]
}

/** Cómo va una pieza de la OT (o su diagnóstico, o el armado y control). */
export type PiezaDeOt = { clave: GrupoDeOt; nombre: string; avance: number; total: number; hechas: number; situacion: Situacion; actual: { nombre: string; asignado: string | null; espera: string[]; faltan: string[]; detencion: Detencion | null } | null }

/** Un repuesto de la OT: quién lo compra, en qué va (por pedir, pedido, recibido) y qué trabajo lo espera. */
export type RepuestoDeOt = {
  id: string
  descripcion: string
  cantidad: number
  medida: string | null
  marca: string | null
  codigo: string | null
  compra: QuienCompra
  proveedor: string | null
  costo: number | null
  estado: EstadoRepuesto
  oc: string | null
  ocId: string | null
  necesitaId: string | null
  necesita: string | null
  recibido: string | null
}

export type DetalleOt = {
  id: string
  numero: number
  estado: EstadoOt
  plazo: Plazo
  avance: number
  cliente: { id: string; nombre: string; contacto: string | null; telefono: string | null }
  motor: string
  numeroMotor: string | null
  equipo: string | null
  piezas: Pieza[]
  cilindros: number | null
  valvulasPorCilindro: number | null
  culatas: number | null
  falla: string | null
  prioridad: PrioridadOt
  entrega: string | null
  creada: string
  entregada: string | null
  entregadaA: string | null
  anulada: string | null
  motivoAnulacion: string | null
  tareas: Tarea[]
  porPieza: PiezaDeOt[]
  repuestos: RepuestoDeOt[]
  cotizaciones: { id: string; numero: number; estado: EstadoCotizacion; total: number; enviada: string | null; decidida: string | null }[]
  historia: { en: string; que: string; quien: string | null }[]
}

export type TarjetaTaller = {
  id: string
  seccionId: string
  nombre: string
  pieza: Pieza
  estado: EstadoTarea
  situacion: Situacion
  espera: string[]
  faltan: string[]
  maquinas: string[]
  detencion: Detencion | null
  horas: number
  asignadoId: string | null
  asignado: string | null
  inicio: string | null
  ot: { id: string; numero: number; motor: string; entrega: string | null; prioridad: PrioridadOt; estado: EstadoOt; plazo: Plazo }
  cliente: string
}

export type Tablero = { secciones: (CargaSeccion & { tareas: TarjetaTaller[] })[] }

export type Actividad = {
  id: string
  seccionId: string
  codigo: string
  nombre: string
  unidad: string
  criterio: Criterio
  precio: number | null
  horas: number
  pieza: Pieza
  paso: number
  tipico: boolean
  activo: boolean
  especialistas: string[]
}

export type Catalogo = { secciones: { id: string; nombre: string; diagnostico: boolean; activa: boolean }[]; trabajos: Actividad[] }

export type Cliente = { id: string; nombre: string; rut: string | null; contacto: string | null; telefono: string | null; correo: string | null; abiertas: number; total: number; ultima: string | null }

export type Persona = { id: string; nombre: string; rol: RolTenant; actividades: string[] }

export type FilaCotizacion = { id: string; numero: number; cliente: string; motor: string; estado: EstadoCotizacion; total: number; creada: string; enviada: string | null; decidida: string | null; otId: string | null; ot: number | null }

export type DetalleCotizacion = {
  id: string
  numero: number
  estado: EstadoCotizacion
  cliente: { id: string; nombre: string; rut: string | null; contacto: string | null }
  otId: string | null
  ot: { numero: number; estado: EstadoOt } | null
  motor: string
  cilindros: number | null
  valvulasPorCilindro: number | null
  culatas: number | null
  lineas: Linea[]
  descuento: number
  notas: string | null
  subtotal: number
  rebaja: number
  neto: number
  iva: number
  total: number
  creada: string
  enviada: string | null
  decidida: string | null
  nota: string | null
}

/** Un repuesto en las compras: de qué OT es, quién lo compra y qué trabajo lo espera. */
export type RepuestoEnCompras = {
  id: string
  descripcion: string
  cantidad: number
  medida: string | null
  marca: string | null
  codigo: string | null
  compra: QuienCompra
  proveedorId: string | null
  proveedor: string | null
  costo: number | null
  estado: EstadoRepuesto
  ot: { id: string; numero: number; motor: string; entrega: string | null; prioridad: PrioridadOt; plazo: Plazo }
  cliente: string
  necesita: string | null
  ocId: string | null
  recibido: string | null
  creado: string
}

export type OrdenDeCompra = {
  id: string
  numero: number
  proveedorId: string | null
  proveedor: string
  /** Dónde se retira y a quién llamar: lo que el chofer necesita del proveedor. */
  direccion: string | null
  telefono: string | null
  chofer: { id: string; nombre: string } | null
  estado: EstadoOc
  llega: string | null
  nota: string | null
  creada: string
  recibida: string | null
  anulada: string | null
  motivo: string | null
  costo: number | null
  repuestos: RepuestoEnCompras[]
}

export type Compras = { porPedir: RepuestoEnCompras[]; clientes: RepuestoEnCompras[]; ordenes: OrdenDeCompra[] }

/** Un proveedor de la lista, con sus órdenes de compra: las que están por retirar, cuántas van y la última. */
export type Proveedor = {
  id: string
  nombre: string
  rut: string | null
  contacto: string | null
  telefono: string | null
  correo: string | null
  direccion: string | null
  nota: string | null
  activo: boolean
  porRetirar: number
  ordenes: number
  ultima: string | null
}
