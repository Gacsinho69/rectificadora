// Las alertas se calculan de los datos al pedirlas: no hay que cerrarlas a mano y desaparecen solas cuando el
// problema se resuelve (el cliente vuelve a entrar, paga, baja el uso).
import type { EstadoPago, EstadoTenant } from '../tenants/reglas'

export const PRIORIDADES = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' } as const
export type Prioridad = keyof typeof PRIORIDADES
export const ORDEN_PRIORIDAD: Record<Prioridad, number> = { critical: 0, high: 1, medium: 2, low: 3 }

export const TIPOS_ALERTA = {
  inactividad: 'Sin actividad',
  pago: 'Problema de pago',
  trial: 'Prueba por vencer',
  limite: 'Cerca del límite',
  logins_fallidos: 'Muchos ingresos fallidos',
  error_critico: 'Error crítico',
  webhook: 'Webhook fallando',
  job: 'Tarea automática fallida',
  consumo_anormal: 'Consumo anormal',
  cross_tenant: 'Acceso a otro cliente',
} as const
export type TipoAlerta = keyof typeof TIPOS_ALERTA

export type Alerta = {
  id: string
  tipo: TipoAlerta
  prioridad: Prioridad
  /** Vacío en lo que es de la plataforma entera. */
  tenantId: string | null
  tenantNombre: string | null
  titulo: string
  detalle: string
}

export type DatosAlerta = {
  tenantId: string
  nombre: string
  estado: EstadoTenant
  estadoPago: EstadoPago
  creado: Date
  trialVence: Date | null
  diasSinLogin: number | null
  /** Cada límite con su fracción usada (0,92 = 92 %). */
  usos: { nombre: string; fraccion: number }[]
  fallidos24h: number
  erroresCriticos24h: number
  webhooksFallidos24h: number
  jobsFallidos24h: number
  crossTenant7d: number
  apiAyer: number
  /** La mediana diaria de llamadas a la API de las dos semanas anteriores. */
  apiMediana14d: number
}

const DIA = 86_400_000
const enUso: EstadoTenant[] = ['active', 'trial', 'past_due']
const pct = (f: number) => `${Math.round(f * 100)} %`

export function alertasDeTenant(t: DatosAlerta, ahora: Date): Alerta[] {
  const lista: Alerta[] = []
  const agregar = (tipo: TipoAlerta, prioridad: Prioridad, titulo: string, detalle: string) =>
    lista.push({ id: `${tipo}:${t.tenantId}`, tipo, prioridad, tenantId: t.tenantId, tenantNombre: t.nombre, titulo, detalle })

  // Lo de seguridad y operación vale aunque el cliente esté suspendido o cancelado.
  if (t.crossTenant7d > 0)
    agregar('cross_tenant', 'critical', 'Intento de acceso a datos de otro cliente', `${t.crossTenant7d} intento(s) en 7 días desde una cuenta de este cliente`)
  if (t.erroresCriticos24h > 0) agregar('error_critico', 'critical', 'Error crítico reciente', `${t.erroresCriticos24h} en las últimas 24 h`)
  if (t.fallidos24h >= 25) agregar('logins_fallidos', 'critical', 'Posible ataque de claves', `${t.fallidos24h} ingresos fallidos en 24 h`)
  else if (t.fallidos24h >= 10) agregar('logins_fallidos', 'high', 'Muchos ingresos fallidos', `${t.fallidos24h} ingresos fallidos en 24 h`)
  if (t.webhooksFallidos24h > 0)
    agregar('webhook', t.webhooksFallidos24h >= 5 ? 'high' : 'medium', 'Webhook fallando', `${t.webhooksFallidos24h} entregas fallidas en 24 h`)
  if (t.jobsFallidos24h > 0) agregar('job', t.jobsFallidos24h >= 3 ? 'high' : 'medium', 'Tarea automática fallida', `${t.jobsFallidos24h} en 24 h`)
  if (t.estadoPago === 'failed') agregar('pago', 'high', 'Pago fallido', 'El último cobro fue rechazado')
  else if (t.estadoPago === 'past_due') agregar('pago', 'medium', 'Pago vencido', 'Tiene una factura vencida sin pagar')

  if (!enUso.includes(t.estado)) return lista

  const dias = t.diasSinLogin
  const diasDeVida = (ahora.getTime() - t.creado.getTime()) / DIA
  if (dias === null && diasDeVida >= 14) agregar('inactividad', 'high', 'Nunca ha entrado', `Creado hace ${Math.floor(diasDeVida)} días y ningún usuario ha iniciado sesión`)
  else if (dias !== null && dias >= 30) agregar('inactividad', 'high', 'Sin actividad hace más de 30 días', `Último ingreso hace ${Math.floor(dias)} días`)
  else if (dias !== null && dias >= 14) agregar('inactividad', 'medium', 'Sin actividad hace más de 14 días', `Último ingreso hace ${Math.floor(dias)} días`)

  if (t.estado === 'trial' && t.trialVence) {
    const quedan = (t.trialVence.getTime() - ahora.getTime()) / DIA
    if (quedan < 0) agregar('trial', 'high', 'Prueba vencida sin convertir', `Venció hace ${Math.ceil(-quedan)} días`)
    else if (quedan <= 3) agregar('trial', 'high', 'Prueba vence en menos de 3 días', `Quedan ${Math.ceil(quedan)} días`)
    else if (quedan <= 7) agregar('trial', 'medium', 'Prueba vence esta semana', `Quedan ${Math.ceil(quedan)} días`)
  }

  const mayor = [...t.usos].sort((a, b) => b.fraccion - a.fraccion)[0]
  if (mayor && mayor.fraccion >= 0.9) agregar('limite', 'high', `${mayor.nombre} sobre el 90 %`, `Va en ${pct(mayor.fraccion)} del límite`)
  else if (mayor && mayor.fraccion >= 0.8) agregar('limite', 'medium', `${mayor.nombre} sobre el 80 %`, `Va en ${pct(mayor.fraccion)} del límite`)

  // Consumo anormal: ayer más del triple de lo normal. Con poco volumen no se avisa (un cliente chico que duplica no es noticia).
  if (t.apiAyer >= 1_000 && t.apiAyer > 3 * Math.max(t.apiMediana14d, 1)) {
    const veces = t.apiAyer / Math.max(t.apiMediana14d, 1)
    agregar('consumo_anormal', veces >= 6 ? 'high' : 'medium', 'Consumo de API anormalmente alto', `Ayer ${t.apiAyer.toLocaleString('es-CL')} llamadas, ${veces.toFixed(1)} veces lo normal`)
  }
  return lista
}

export type DatosPlataforma = { erroresCriticos24h: number; jobsFallidos24h: number; webhooksFallidos24h: number }

/** Lo que falla en la plataforma misma, sin ser de un cliente (la sincronización de pagos, el correo). */
export function alertasDePlataforma(p: DatosPlataforma): Alerta[] {
  const lista: Alerta[] = []
  const base = { tenantId: null, tenantNombre: null }
  if (p.erroresCriticos24h > 0)
    lista.push({ ...base, id: 'error_critico:plataforma', tipo: 'error_critico', prioridad: 'critical', titulo: 'Error crítico en la plataforma', detalle: `${p.erroresCriticos24h} en las últimas 24 h` })
  if (p.jobsFallidos24h > 0)
    lista.push({ ...base, id: 'job:plataforma', tipo: 'job', prioridad: p.jobsFallidos24h >= 3 ? 'high' : 'medium', titulo: 'Tarea automática de la plataforma fallida', detalle: `${p.jobsFallidos24h} en 24 h` })
  if (p.webhooksFallidos24h > 0)
    lista.push({ ...base, id: 'webhook:plataforma', tipo: 'webhook', prioridad: 'medium', titulo: 'Webhook de la plataforma fallando', detalle: `${p.webhooksFallidos24h} en 24 h` })
  return lista
}

export const ordenarAlertas = (alertas: Alerta[]) =>
  [...alertas].sort((a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || (a.tenantNombre ?? '').localeCompare(b.tenantNombre ?? ''))
