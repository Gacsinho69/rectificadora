// Lo que responde la API del sistema de la rectificadora, como lo ven las pantallas.
import type { EstadoCotizacion, Linea } from '../../comercial/reglas'
import type { RolTenant } from '../../usuarios/reglas'
import type { EstadoOt, EstadoTarea, Pieza, PrioridadOt } from '../reglas'

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
}

export type Inicio = {
  cifras: { recibidas: number; esperando: number; enTaller: number; calidad: number; listas: number; atrasadas: number; porVencer: number; entregadasMes: number }
  urgentes: FilaOt[]
  carga: { seccionId: string; nombre: string; porHacer: number; enProceso: number; horas: number }[]
  misTareas: { id: string; nombre: string; estado: EstadoTarea; otId: string; ot: number; motor: string; entrega: string | null; seccion: string }[]
  comercial: { enviadasMes: number; cotizadoMes: number; aceptadasMes: number; aceptadoMes: number; pendientes: number; montoPendiente: number; tasaAceptacion: number | null } | null
}

export type Tarea = {
  id: string
  nombre: string
  cantidad: number
  seccionId: string
  seccion: string
  diagnostico: boolean
  estado: EstadoTarea
  horas: number
  asignadoId: string | null
  asignado: string | null
  inicio: string | null
  termino: string | null
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
  falla: string | null
  prioridad: PrioridadOt
  entrega: string | null
  creada: string
  entregada: string | null
  entregadaA: string | null
  anulada: string | null
  motivoAnulacion: string | null
  tareas: Tarea[]
  cotizaciones: { id: string; numero: number; estado: EstadoCotizacion; total: number; enviada: string | null; decidida: string | null }[]
  historia: { en: string; que: string; quien: string | null }[]
}

export type TarjetaTaller = {
  id: string
  nombre: string
  estado: EstadoTarea
  horas: number
  asignadoId: string | null
  asignado: string | null
  inicio: string | null
  ot: { id: string; numero: number; motor: string; entrega: string | null; prioridad: PrioridadOt; estado: EstadoOt; plazo: Plazo }
  cliente: string
}

export type Catalogo = {
  secciones: { id: string; nombre: string; diagnostico: boolean; activa: boolean }[]
  trabajos: { id: string; seccionId: string; codigo: string; nombre: string; unidad: string; precio: number | null; horas: number; activo: boolean }[]
}

export type Cliente = { id: string; nombre: string; rut: string | null; contacto: string | null; telefono: string | null; correo: string | null; abiertas: number; total: number; ultima: string | null }

export type Persona = { id: string; nombre: string; rol: RolTenant }

export type FilaCotizacion = { id: string; numero: number; cliente: string; motor: string; estado: EstadoCotizacion; total: number; creada: string; enviada: string | null; decidida: string | null; otId: string | null; ot: number | null }

export type DetalleCotizacion = {
  id: string
  numero: number
  estado: EstadoCotizacion
  cliente: { id: string; nombre: string; rut: string | null; contacto: string | null }
  otId: string | null
  ot: { numero: number; estado: EstadoOt } | null
  motor: string
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
