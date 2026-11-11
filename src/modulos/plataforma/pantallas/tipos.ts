// Lo que responde la API de la consola, como lo ven las pantallas. Sale de los tipos del servidor siempre que se puede.
import type { Alerta, Prioridad } from '../../alertas/reglas'
import type { EventoVisible } from '../../eventos/consulta'
import type { EstadoFactura } from '../../facturacion/reglas'
import type { EstadoIntegracion, TipoIntegracion } from '../../integraciones/reglas'
import type { Salud } from '../../salud/reglas'
import type { EstadoPago, EstadoTenant, Funcion, Limites, Plan, UsoClave } from '../../tenants/reglas'
import type { RolTenant } from '../../usuarios/reglas'
import type { UsuarioVisible } from '../consultas'
import type { ResumenTenant, Uso } from '../panorama'

export type { Alerta, EventoVisible, ResumenTenant, Uso, UsuarioVisible }

export type Dia = { dia: string; logins: number; usuarios: number; fallidos: number; operaciones: number }

export type RespuestaResumen = {
  tenants: { total: number; porEstado: Record<EstadoTenant, number> }
  usuarios: { total: number; activos24h: number; activos7d: number; activos30d: number }
  logins: { d1: number; d7: number; d30: number; fallidos24h: number; fallidos7d: number; errores24h: number; criticos24h: number }
  mrr: { total: number; enRiesgo: number; clientesPagando: number }
  pagos: { vencidos: number; fallidos: number }
  errores: { recientes: EventoVisible[] }
  alertas: { total: number; porPrioridad: Record<Prioridad, number>; principales: Alerta[] }
  atencion: { id: string; nombre: string; plan: Plan; estado: EstadoTenant; mrr: number; salud: Salud; ultimoLogin: string | null; alertas: number; motivo: string | null }[]
  porDia: Dia[]
}

export type DetalleTenant = ResumenTenant & {
  dominio: string
  dominioPropio: string | null
  limites: Limites
  limitesDelPlan: Limites
  ajustes: Partial<Limites>
  funciones: Record<Funcion, boolean>
  accesoSoporte: boolean
  mfaObligatorio: boolean
  administradores: { id: string; nombre: string; correo: string; estado: string; ultimoLogin: string | null }[]
  impersonaciones: { id: string; admin: string; usuario: string; motivo: string; inicio: string; fin: string | null; vence: string }[]
}

export type ActividadTenant = {
  completo: boolean
  porDia: Dia[]
  logins: EventoVisible[]
  fallidos: EventoVisible[]
  acciones: EventoVisible[]
  operaciones: EventoVisible[]
  sinActividad: { id: string; nombre: string; correo: string; rol: RolTenant; ultimoLogin: string | null }[]
}

export type UsoTenant = {
  usos: Uso[]
  serie: { dia: string; api: number; almacenamiento: number; ots: number; cotizaciones: number; documentos: number; mensajes: number }[]
  totales: { api: number; ots: number; cotizaciones: number; documentos: number; mensajes: number }
  funciones: { clave: UsoClave; nombre: string; usos30d: number }[]
}

export type Factura = { id: string; numero: string; periodo: string; monto: number; estado: EstadoFactura; emitida: string; vence: string; pagada: string | null; motivoFalla: string | null }

export type Integraciones = {
  clavesApi: { id: string; nombre: string; prefijo: string; creada: string; ultimoUso: string | null; revocada: string | null }[]
  integraciones: { id: string; tipo: TipoIntegracion; nombre: string; destino: string; estado: EstadoIntegracion; ultimoExito: string | null; ultimaFalla: string | null; ultimoError: string | null }[]
}

export type SeguridadTenant = {
  completo: boolean
  fallidos: { h24: number; d7: number; d30: number }
  fallidosRecientes: EventoVisible[]
  ips: { ip: string | null; pais: string; ciudad: string | null; inicios: number; fallidos: number; ultimo: string }[]
  paises: { pais: string; inicios: number; fallidos: number }[]
  mfa: { total: number; conMfa: number }
  sso: { activo: boolean; proveedor: string | null }
  clavesApi: Integraciones['clavesApi']
  cambiosDeRol: EventoVisible[]
  sensibles: EventoVisible[]
  mfaObligatorio: boolean
  accesoSoporte?: boolean
}

export type PaginaEventos = { total: number; filas: EventoVisible[]; completo?: boolean }

export type FacturacionTenant = { plan: Plan; precioPlan?: number; mrr?: number; montoMensual?: number; estadoPago: EstadoPago; proximoCobro: string | null; correo: string; facturas: Factura[]; eventos?: EventoVisible[] }
