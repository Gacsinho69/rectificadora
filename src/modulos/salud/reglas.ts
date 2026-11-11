// La salud de un cliente: un puntaje de 0 a 100 que suma seis factores, cada uno con su peso, y su estado.
// Es la base para la segunda fase (tickets de soporte, tendencia, predicción de abandono): un factor nuevo se agrega
// aquí con su peso, y la explicación de cada puntaje sale sola en la ficha del cliente.
import type { EstadoPago } from '../tenants/reglas'

export const ESTADOS_SALUD = { healthy: 'Sano', warning: 'Atención', at_risk: 'En riesgo', critical: 'Crítico' } as const
export type EstadoSalud = keyof typeof ESTADOS_SALUD

export type DatosSalud = {
  /** Días desde el último inicio de sesión de cualquiera de sus usuarios; null si nadie ha entrado nunca. */
  diasSinLogin: number | null
  usuariosTotal: number
  usuariosActivos7d: number
  /** Cuántas de las funciones clave usó en los últimos 30 días, sobre cuántas hay. */
  funcionesUsadas: number
  funcionesTotal: number
  estadoPago: EstadoPago
  errores7d: number
  /** El límite más ocupado, como fracción (0,92 = 92 %). */
  usoMaximo: number
  /** Tickets o incidentes abiertos, cuando haya integración con soporte. */
  incidentesAbiertos?: number
}

export type Factor = { clave: string; nombre: string; puntos: number; maximo: number; detalle: string }
export type Salud = { puntaje: number; estado: EstadoSalud; factores: Factor[] }

const tramo = (valor: number, tramos: [hasta: number, puntos: number][], resto: number) =>
  tramos.find(([hasta]) => valor <= hasta)?.[1] ?? resto

export function calcularSalud(d: DatosSalud): Salud {
  const dias = d.diasSinLogin
  const login = dias === null ? 0 : tramo(dias, [[1, 25], [3, 20], [7, 14], [14, 7], [30, 3]], 0)
  const proporcionActivos = d.usuariosTotal > 0 ? d.usuariosActivos7d / d.usuariosTotal : 0
  // Con 6 de cada 10 usuarios entrando cada semana ya está completo: no todos los cargos entran a diario.
  const activos = Math.round(20 * Math.min(1, proporcionActivos / 0.6))
  const funciones = d.funcionesTotal > 0 ? Math.round((15 * d.funcionesUsadas) / d.funcionesTotal) : 0
  const pago = { paid: 20, none: 20, past_due: 8, failed: 0, cancelled: 0 }[d.estadoPago]
  const errores = tramo(d.errores7d, [[0, 10], [2, 7], [5, 4]], 0)
  const holgura = d.usoMaximo < 0.8 ? 10 : d.usoMaximo < 0.9 ? 6 : d.usoMaximo < 1 ? 3 : 0
  const incidentes = d.incidentesAbiertos ? -Math.min(10, d.incidentesAbiertos * 2) : 0

  const factores: Factor[] = [
    { clave: 'login', nombre: 'Frecuencia de ingreso', puntos: login, maximo: 25, detalle: dias === null ? 'Nadie ha entrado nunca' : dias < 1 ? 'Entraron hoy' : `Último ingreso hace ${Math.floor(dias)} d` },
    { clave: 'activos', nombre: 'Usuarios activos', puntos: activos, maximo: 20, detalle: `${d.usuariosActivos7d} de ${d.usuariosTotal} entraron esta semana` },
    { clave: 'funciones', nombre: 'Uso de funciones clave', puntos: funciones, maximo: 15, detalle: `${d.funcionesUsadas} de ${d.funcionesTotal} en 30 días` },
    { clave: 'pago', nombre: 'Pagos al día', puntos: pago, maximo: 20, detalle: { paid: 'Al día', none: 'Sin cobro', past_due: 'Pago vencido', failed: 'Pago fallido', cancelled: 'Suscripción cancelada' }[d.estadoPago] },
    { clave: 'errores', nombre: 'Errores recientes', puntos: errores, maximo: 10, detalle: d.errores7d ? `${d.errores7d} en 7 días` : 'Sin errores en 7 días' },
    { clave: 'limites', nombre: 'Holgura en los límites', puntos: holgura, maximo: 10, detalle: `El límite más usado va en ${Math.round(d.usoMaximo * 100)} %` },
  ]
  if (incidentes) factores.push({ clave: 'incidentes', nombre: 'Incidentes abiertos', puntos: incidentes, maximo: 0, detalle: `${d.incidentesAbiertos} abiertos` })

  const puntaje = Math.max(0, Math.min(100, factores.reduce((suma, f) => suma + f.puntos, 0)))
  let estado: EstadoSalud = puntaje >= 75 ? 'healthy' : puntaje >= 55 ? 'warning' : puntaje >= 35 ? 'at_risk' : 'critical'
  // Un pago fallido de un cliente que además dejó de entrar es abandono en curso, aunque el resto se vea bien.
  if (d.estadoPago === 'failed' && (dias === null || dias > 14)) estado = 'critical'
  return { puntaje, estado, factores }
}
