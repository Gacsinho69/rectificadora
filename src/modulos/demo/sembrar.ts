// Datos de demostración: rectificadoras ficticias con perfiles distintos, para que cada alerta, cada estado de salud
// y cada filtro tengan algo que mostrar. Todo sale de una semilla: con la misma semilla y la misma hora, los mismos
// datos. Los nombres, correos (.test) e IPs son inventados. Solo corre en desarrollo, con la base vacía. Todas las
// personas (del equipo y de cada rectificadora) entran con la clave «demo1234»; las invitadas, con un enlace nuevo.
import { count } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import type { Base } from '../../base'
import { nuevoId } from '../../ids'
import { cifrarClave } from '../acceso/claves'
import { TODOS_LOS_PERMISOS } from '../acceso/permisos'
import { events } from '../eventos/tablas'
import type { Severidad, TipoActor, TipoEvento } from '../eventos/tipos'
import type { EstadoFactura } from '../facturacion/reglas'
import { invoices } from '../facturacion/tablas'
import type { EstadoIntegracion } from '../integraciones/reglas'
import { apiKeys, integrations } from '../integraciones/tablas'
import { customers, quotes } from '../comercial/tablas'
import { impersonations } from '../soporte/tablas'
import { customPieces, services, serviceSpecialists, shopSections, taskHolds, workOrders, workOrderTasks } from '../taller/tablas'
import { purchaseOrders, suppliers, supplies, supplyMovements, workOrderParts } from '../compras/tablas'
import { machines, machineServices, machineStops } from '../maquinas/tablas'
import { type EstadoPago, type EstadoTenant, FUNCIONES_DEL_PLAN, type Funcion, PLANES, type Plan, type Region, type UsoClave } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import { usageDaily } from '../uso/tablas'
import type { EstadoUsuario, RolTenant } from '../usuarios/reglas'
import { platformAdmins, users } from '../usuarios/tablas'
import { sembrarTaller } from './taller'

const DIA = 86_400_000

type Extra = 'ataque' | 'webhook' | 'job' | 'critico' | 'pico' | 'cross' | 'sso' | 'exporta' | 'api'
type Perfil = {
  nombre: string
  plan: Plan
  estado: EstadoTenant
  pago: EstadoPago
  /** Hace cuántos días se creó. */
  edad: number
  usuarios: number
  /** Probabilidad de que un usuario entre un día hábil. */
  actividad: number
  /** Días sin que nadie entre (0: entran hasta hoy). */
  silencio?: number
  nunca?: boolean
  /** Fracción del almacenamiento del plan ocupada hoy. */
  almacenamiento: number
  /** Días para que venza la prueba (negativo: ya venció). */
  trial?: number
  region?: Region
  pais?: 'Chile' | 'Argentina' | 'Perú'
  ciudad: string
  mfa: number
  extras?: Extra[]
  sinSoporte?: boolean
}

const PERFILES: Perfil[] = [
  { nombre: 'Rectificadora Los Andes', plan: 'enterprise', estado: 'active', pago: 'paid', edad: 640, usuarios: 48, actividad: 0.75, almacenamiento: 0.55, ciudad: 'Los Andes', mfa: 0.9, extras: ['sso', 'api', 'exporta'] },
  { nombre: 'Motores del Pacífico', plan: 'pro', estado: 'active', pago: 'paid', edad: 410, usuarios: 22, actividad: 0.7, almacenamiento: 0.86, ciudad: 'San Antonio', mfa: 0.5 },
  { nombre: 'Rectificadora Biobío', plan: 'pro', estado: 'active', pago: 'paid', edad: 380, usuarios: 18, actividad: 0.6, almacenamiento: 0.4, ciudad: 'Concepción', mfa: 0.2, extras: ['ataque'] },
  { nombre: 'Diesel Norte Antofagasta', plan: 'pro', estado: 'active', pago: 'failed', edad: 300, usuarios: 14, actividad: 0.5, silencio: 20, almacenamiento: 0.35, ciudad: 'Antofagasta', mfa: 0.1 },
  { nombre: 'Rectificadora San Bernardo', plan: 'starter', estado: 'active', pago: 'paid', edad: 260, usuarios: 7, actividad: 0.55, almacenamiento: 0.3, ciudad: 'San Bernardo', mfa: 0.3 },
  { nombre: 'Taller Hidalgo Motores', plan: 'starter', estado: 'past_due', pago: 'past_due', edad: 220, usuarios: 6, actividad: 0.4, almacenamiento: 0.5, ciudad: 'Rancagua', mfa: 0 },
  { nombre: 'Rectificadora Austral', plan: 'pro', estado: 'active', pago: 'paid', edad: 500, usuarios: 26, actividad: 0.65, almacenamiento: 0.6, ciudad: 'Coyhaique', mfa: 0.6, extras: ['webhook', 'api'] },
  { nombre: 'Motores Quilicura', plan: 'free', estado: 'active', pago: 'none', edad: 90, usuarios: 3, actividad: 0.5, almacenamiento: 0.7, ciudad: 'Quilicura', mfa: 0 },
  { nombre: 'Rectificadora Temuco', plan: 'pro', estado: 'trial', pago: 'none', edad: 12, usuarios: 5, actividad: 0.5, almacenamiento: 0.05, trial: 2, ciudad: 'Temuco', mfa: 0.2 },
  { nombre: 'Reconstructora del Maule', plan: 'pro', estado: 'trial', pago: 'none', edad: 9, usuarios: 8, actividad: 0.3, almacenamiento: 0.03, trial: 6, ciudad: 'Talca', mfa: 0 },
  { nombre: 'Rectificadora Valparaíso', plan: 'enterprise', estado: 'active', pago: 'paid', edad: 700, usuarios: 64, actividad: 0.8, almacenamiento: 0.7, ciudad: 'Valparaíso', mfa: 0.95, extras: ['pico', 'sso', 'api'] },
  { nombre: 'Motores Coquimbo', plan: 'starter', estado: 'active', pago: 'paid', edad: 180, usuarios: 5, actividad: 0.4, silencio: 35, almacenamiento: 0.2, ciudad: 'Coquimbo', mfa: 0 },
  { nombre: 'Rectificadora Osorno', plan: 'starter', estado: 'suspended', pago: 'failed', edad: 400, usuarios: 6, actividad: 0.4, silencio: 50, almacenamiento: 0.25, ciudad: 'Osorno', mfa: 0 },
  { nombre: 'Turbo Diesel Rancagua', plan: 'pro', estado: 'cancelled', pago: 'cancelled', edad: 520, usuarios: 10, actividad: 0.5, silencio: 80, almacenamiento: 0.3, ciudad: 'Rancagua', mfa: 0.3 },
  { nombre: 'Rectificadora Iquique', plan: 'pro', estado: 'active', pago: 'paid', edad: 150, usuarios: 12, actividad: 0.65, almacenamiento: 0.3, ciudad: 'Iquique', mfa: 0.4, extras: ['job'] },
  { nombre: 'Culatas y Bloques SpA', plan: 'starter', estado: 'active', pago: 'paid', edad: 120, usuarios: 9, actividad: 0.6, almacenamiento: 0.45, ciudad: 'Santiago', mfa: 0.2, extras: ['critico'] },
  { nombre: 'Rectificadora Mendoza', plan: 'pro', estado: 'active', pago: 'paid', edad: 330, usuarios: 15, actividad: 0.6, almacenamiento: 0.5, region: 'sa-2', pais: 'Argentina', ciudad: 'Mendoza', mfa: 0.3 },
  { nombre: 'Motores Lima Norte', plan: 'starter', estado: 'active', pago: 'paid', edad: 200, usuarios: 6, actividad: 0.45, almacenamiento: 0.35, region: 'sa-2', pais: 'Perú', ciudad: 'Lima', mfa: 0 },
  { nombre: 'Rectificadora Arica', plan: 'free', estado: 'active', pago: 'none', edad: 30, usuarios: 2, actividad: 0, nunca: true, almacenamiento: 0.01, ciudad: 'Arica', mfa: 0 },
  { nombre: 'Rectificadora Puerto Montt', plan: 'pro', estado: 'active', pago: 'paid', edad: 280, usuarios: 20, actividad: 0.7, almacenamiento: 0.5, ciudad: 'Puerto Montt', mfa: 0.5, extras: ['cross'] },
  { nombre: 'Bombas Inyectoras Talca', plan: 'starter', estado: 'active', pago: 'paid', edad: 240, usuarios: 8, actividad: 0.6, almacenamiento: 0.4, ciudad: 'Talca', mfa: 0.25 },
  { nombre: 'Rectificadora Chillán', plan: 'starter', estado: 'active', pago: 'paid', edad: 160, usuarios: 6, actividad: 0.35, almacenamiento: 0.82, ciudad: 'Chillán', mfa: 0 },
  { nombre: 'Motores Pesados Calama', plan: 'enterprise', estado: 'active', pago: 'paid', edad: 450, usuarios: 38, actividad: 0.7, almacenamiento: 0.45, ciudad: 'Calama', mfa: 0.8, extras: ['exporta', 'sso', 'webhook'] },
  { nombre: 'Rectificadora La Serena', plan: 'starter', estado: 'trial', pago: 'none', edad: 20, usuarios: 4, actividad: 0.2, almacenamiento: 0.02, trial: -3, ciudad: 'La Serena', mfa: 0 },
  { nombre: 'Rectificadora Curicó', plan: 'pro', estado: 'past_due', pago: 'past_due', edad: 310, usuarios: 11, actividad: 0.6, almacenamiento: 0.4, ciudad: 'Curicó', mfa: 0.3 },
  { nombre: 'Motor Center Santiago', plan: 'pro', estado: 'active', pago: 'paid', edad: 90, usuarios: 16, actividad: 0.75, almacenamiento: 0.25, ciudad: 'Santiago', mfa: 0.7, sinSoporte: true },
  { nombre: 'Rectificadora Copiapó', plan: 'starter', estado: 'active', pago: 'paid', edad: 60, usuarios: 4, actividad: 0.55, silencio: 8, almacenamiento: 0.15, ciudad: 'Copiapó', mfa: 0 },
  { nombre: 'Rectificadora Los Ángeles', plan: 'free', estado: 'active', pago: 'none', edad: 45, usuarios: 2, actividad: 0.4, almacenamiento: 0.2, ciudad: 'Los Ángeles', mfa: 0 },
  { nombre: 'Reman Diesel SpA', plan: 'enterprise', estado: 'trial', pago: 'none', edad: 5, usuarios: 12, actividad: 0.6, almacenamiento: 0.02, trial: 9, ciudad: 'Santiago', mfa: 0.4, extras: ['sso'] },
  { nombre: 'Rectificadora Punta Arenas', plan: 'starter', estado: 'active', pago: 'paid', edad: 140, usuarios: 5, actividad: 0.5, silencio: 16, almacenamiento: 0.3, ciudad: 'Punta Arenas', mfa: 0 },
]

const NOMBRES = ['Juan', 'María', 'Pedro', 'Camila', 'Diego', 'Valentina', 'José', 'Francisca', 'Luis', 'Catalina', 'Jorge', 'Fernanda', 'Carlos', 'Javiera', 'Andrés', 'Constanza', 'Felipe', 'Daniela', 'Rodrigo', 'Paula', 'Cristián', 'Carolina', 'Sebastián', 'Isidora', 'Ignacio', 'Antonia', 'Héctor', 'Bárbara', 'Manuel', 'Gabriela']
const APELLIDOS = ['González', 'Muñoz', 'Rojas', 'Díaz', 'Pérez', 'Soto', 'Contreras', 'Silva', 'Martínez', 'Sepúlveda', 'Morales', 'Rodríguez', 'López', 'Fuentes', 'Hernández', 'Torres', 'Araya', 'Flores', 'Espinoza', 'Valenzuela', 'Castillo', 'Tapia', 'Reyes', 'Gutiérrez', 'Castro', 'Pizarro', 'Álvarez', 'Vásquez', 'Sánchez', 'Fernández']
const NAVEGADORES = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Mozilla/5.0 (Linux; Android 15; SM-A556E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
]

/** Generador con semilla (mulberry32): mismos datos en cada siembra. */
function azarCon(semilla: number) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const slugDe = (s: string) => sinTildes(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function enLotes<T extends PgTable>(base: Base, tabla: T, filas: T['$inferInsert'][], tamano = 400) {
  for (let i = 0; i < filas.length; i += tamano) await base.insert(tabla).values(filas.slice(i, i + tamano) as never)
}

/** La clave de todas las personas de la demostración. */
export const CLAVE_DEMO = 'demo1234'

export async function sembrarDemo(base: Base, ahora = new Date(), semilla = 20261111) {
  // Solo en una base vacía de verdad: si ya hay una rectificadora o alguien del equipo (el primero se agrega antes que
  // cualquier cliente), no se siembra nada, aunque DEMOSTRACION=si haya quedado puesta por error.
  const [{ hay }] = await base.select({ hay: count() }).from(tenants)
  const [{ delEquipo }] = await base.select({ delEquipo: count() }).from(platformAdmins)
  if (hay > 0 || delEquipo > 0) return false
  // Una sola derivación para todos: con su sal propia por persona, la siembra tardaría segundos de más.
  const claveDemo = await cifrarClave(CLAVE_DEMO)

  const azar = azarCon(semilla)
  const entre = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1))
  const uno = <T>(lista: readonly T[]) => lista[Math.floor(azar() * lista.length)]
  const id = (prefijo: string) => nuevoId(prefijo, azar)
  const hoy = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()))
  /** Un momento del día `dias` atrás, en horario de taller de Chile (8 a 20 h, UTC−3). */
  const enHorario = (dias: number) => {
    const t = new Date(hoy.getTime() - dias * DIA + (11 + azar() * 12) * 3_600_000)
    return t > ahora ? new Date(ahora.getTime() - azar() * 3_600_000) : t
  }
  const haceHoras = (horas: number) => new Date(ahora.getTime() - horas * 3_600_000)

  const listaEventos: (typeof events.$inferInsert)[] = []
  const evento = (e: {
    tenantId: string | null
    tipo: TipoEvento
    en: Date
    actorId?: string | null
    actorType?: TipoActor
    userId?: string | null
    severidad?: Severidad
    targetId?: string | null
    targetType?: string | null
    metadata?: Record<string, unknown>
    ip?: string | null
    agente?: string | null
  }) =>
    listaEventos.push({
      id: id('ev'),
      tenantId: e.tenantId,
      actorId: e.actorId ?? null,
      actorType: e.actorType ?? (e.actorId ? 'user' : 'system'),
      userId: e.userId ?? null,
      eventType: e.tipo,
      severity: e.severidad ?? (e.tipo.startsWith('system.') ? 'error' : e.tipo === 'user.failed_login' ? 'warning' : 'info'),
      targetId: e.targetId ?? null,
      targetType: e.targetType ?? null,
      metadata: e.metadata ?? {},
      ipAddress: e.ip ?? null,
      userAgent: e.agente ?? null,
      createdAt: e.en,
    })

  // ── El equipo de la plataforma ──
  const equipo = [
    { id: id('adm'), name: 'Valentina Rojas', email: 'valentina.rojas@plataforma.test', permissions: TODOS_LOS_PERMISOS },
    { id: id('adm'), name: 'Matías Soto', email: 'matias.soto@plataforma.test', permissions: ['users.create', 'users.block', 'support.impersonate'] as typeof TODOS_LOS_PERMISOS },
    { id: id('adm'), name: 'Camila Fuentes', email: 'camila.fuentes@plataforma.test', permissions: ['tenants.create', 'tenants.plan', 'tenants.status'] as typeof TODOS_LOS_PERMISOS },
  ]
  await base.insert(platformAdmins).values(equipo.map((a) => ({ ...a, passwordHash: claveDemo, createdAt: new Date(ahora.getTime() - 800 * DIA) })))
  const [valentina, matias, camila] = equipo

  const filasTenants: (typeof tenants.$inferInsert)[] = []
  const filasUsuarios: (typeof users.$inferInsert)[] = []
  const filasFacturas: (typeof invoices.$inferInsert)[] = []
  const filasUso: (typeof usageDaily.$inferInsert)[] = []
  const filasClaves: (typeof apiKeys.$inferInsert)[] = []
  const filasIntegraciones: (typeof integrations.$inferInsert)[] = []
  const filasImpersonaciones: (typeof impersonations.$inferInsert)[] = []
  const filasSecciones: (typeof shopSections.$inferInsert)[] = []
  const filasTrabajos: (typeof services.$inferInsert)[] = []
  const filasClientes: (typeof customers.$inferInsert)[] = []
  const filasOts: (typeof workOrders.$inferInsert)[] = []
  const filasTareas: (typeof workOrderTasks.$inferInsert)[] = []
  const filasEspecialistas: (typeof serviceSpecialists.$inferInsert)[] = []
  const filasDetenciones: (typeof taskHolds.$inferInsert)[] = []
  const filasProveedores: (typeof suppliers.$inferInsert)[] = []
  const filasMaquinas: (typeof machines.$inferInsert)[] = []
  const filasInsumos: (typeof supplies.$inferInsert)[] = []
  const filasMovimientos: (typeof supplyMovements.$inferInsert)[] = []
  const filasUsosMaquinas: (typeof machineServices.$inferInsert)[] = []
  const filasParadas: (typeof machineStops.$inferInsert)[] = []
  const filasOrdenes: (typeof purchaseOrders.$inferInsert)[] = []
  const filasRepuestos: (typeof workOrderParts.$inferInsert)[] = []
  const filasCotizaciones: (typeof quotes.$inferInsert)[] = []
  const filasPiezas: (typeof customPieces.$inferInsert)[] = []
  const admins = new Map<string, string>()
  const usuariosDe = new Map<string, string[]>()
  let folio = 1

  for (const p of PERFILES) {
    const tenantId = id('tn')
    const slug = slugDe(p.nombre.replace(/^Rectificadora /, ''))
    const creado = new Date(hoy.getTime() - p.edad * DIA + 13 * 3_600_000)
    const extras = new Set(p.extras ?? [])
    const funciones: Partial<Record<Funcion, boolean>> = Object.fromEntries(FUNCIONES_DEL_PLAN[p.plan].map((f) => [f, true]))
    // Lo que la demostración simula de uso (portal, inventario, API) sigue saliendo del plan como antes de que las
    // funciones fueran módulos: así la siembra da los mismos datos.
    const usaPortal = p.plan !== 'free'
    const usaInventario = p.plan === 'pro' || p.plan === 'enterprise'
    const usaApi = p.plan === 'enterprise' || extras.has('api')
    const mrr = p.estado === 'trial' || p.plan === 'free' ? 0 : p.plan === 'enterprise' ? PLANES.enterprise.precio + entre(0, 6) * 25_000 : PLANES[p.plan].precio
    const pais = p.pais ?? 'Chile'
    // Las IPs de la oficina y de los celulares de cada taller. Rangos inventados, coherentes por cliente.
    const oficinas = Array.from({ length: entre(1, 3) }, () => `${uno([190, 200, 181, 186, 152])}.${entre(10, 250)}.${entre(0, 255)}.${entre(2, 254)}`)
    const ipDe = () => (azar() < 0.8 ? uno(oficinas) : `${uno([191, 201, 179])}.${entre(10, 250)}.${entre(0, 255)}.${entre(2, 254)}`)
    let proximoCobro: Date | null = null
    if (mrr > 0 && p.estado !== 'cancelled') {
      proximoCobro = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), creado.getUTCDate(), 12))
      if (proximoCobro <= ahora) proximoCobro = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, creado.getUTCDate(), 12))
    }
    filasTenants.push({
      id: tenantId,
      name: p.nombre,
      slug,
      customDomain: p.plan === 'enterprise' && p.estado === 'active' ? `portal.${slug}.test` : null,
      region: p.region ?? 'sa-1',
      status: p.estado,
      plan: p.plan,
      limitsOverride: p.nombre === 'Motores Pesados Calama' ? { api_calls_month: 8_000_000 } : {},
      featureFlags: funciones,
      billingEmail: `facturacion@${slug}.test`,
      billingStatus: p.pago,
      mrr,
      nextBillingAt: proximoCobro,
      trialEndsAt: p.trial !== undefined ? new Date(ahora.getTime() + p.trial * DIA) : null,
      supportAccess: !p.sinSoporte,
      mfaRequired: p.mfa >= 0.9,
      createdAt: creado,
      updatedAt: creado,
    })
    evento({ tenantId, tipo: 'tenant.created', en: creado, metadata: { plan: p.plan, origen: p.estado === 'trial' ? 'registro_web' : 'ventas' } })

    // ── Usuarios ──
    const ids: string[] = []
    const correos = new Set<string>()
    let dueno = ''
    const totalConInvitados = p.usuarios + (p.usuarios >= 5 ? entre(0, 2) : 0)
    for (let i = 0; i < totalConInvitados; i++) {
      const nombre = `${uno(NOMBRES)} ${uno(APELLIDOS)}`
      const [primero, apellido] = nombre.split(' ')
      let correo = `${sinTildes(primero)[0]}${sinTildes(apellido)}@${slug}.test`
      for (let n = 2; correos.has(correo); n++) correo = `${sinTildes(primero)[0]}${sinTildes(apellido)}${n}@${slug}.test`
      correos.add(correo)
      const invitado = i >= p.usuarios
      const sorteo = azar()
      const rol: RolTenant = i === 0 || sorteo < 0.08 ? 'admin' : sorteo < 0.22 ? 'planner' : sorteo < 0.3 ? 'viewer' : 'technician'
      const estado: EstadoUsuario = invitado ? 'invited' : i > 0 && azar() < 0.04 ? 'blocked' : 'active'
      // El primero llega con el cliente; los demás se suman a lo largo de su vida.
      const edadUsuario = i === 0 ? p.edad : invitado ? entre(1, 12) : Math.max(1, Math.floor(p.edad * (1 - azar() * 0.9)))
      const creadoU = new Date(Math.max(creado.getTime(), hoy.getTime() - edadUsuario * DIA + 14 * 3_600_000))
      const userId = id('us')
      if (i === 0) dueno = userId
      ids.push(userId)
      filasUsuarios.push({
        id: userId,
        tenantId,
        name: nombre,
        email: correo,
        role: rol,
        status: estado,
        mfaEnabled: !invitado && azar() < p.mfa,
        passwordHash: invitado ? null : claveDemo,
        invitedAt: invitado ? creadoU : null,
        blockedAt: estado === 'blocked' ? enHorario(entre(3, 40)) : null,
        createdAt: creadoU,
      })
      evento({ tenantId, tipo: invitado ? 'user.invited' : 'user.created', en: creadoU, actorId: i === 0 ? null : dueno, userId, targetId: userId, targetType: 'user', metadata: { rol } })
      if (estado === 'blocked')
        evento({ tenantId, tipo: 'user.blocked', en: filasUsuarios.at(-1)!.blockedAt as Date, actorId: dueno, userId, targetId: userId, targetType: 'user', metadata: { motivo: 'Dejó la empresa' } })
    }
    admins.set(tenantId, dueno)
    usuariosDe.set(tenantId, ids)
    const misUsuarios = filasUsuarios.filter((u) => u.tenantId === tenantId)

    // Algunos cambios de rol a lo largo del tiempo.
    for (const u of misUsuarios.filter((u) => u.status === 'active' && u.id !== dueno).slice(0, entre(0, 2))) {
      const despues = u.role
      const antes: RolTenant = despues === 'admin' ? 'planner' : despues === 'planner' ? 'technician' : 'viewer'
      evento({ tenantId, tipo: 'user.role_changed', en: enHorario(entre(5, Math.min(120, p.edad))), actorId: dueno, userId: u.id, targetId: u.id, targetType: 'user', metadata: { antes, despues }, ip: uno(oficinas), agente: NAVEGADORES[0] })
    }

    // ── Ingresos: de cada usuario, día por día, los últimos 90 días ──
    const silencio = p.silencio ?? 0
    for (const u of misUsuarios) {
      if (u.status === 'invited' || p.nunca) continue
      const ganas = p.actividad * (0.4 + azar() * 0.9)
      // Uno de cada siete deja de entrar por su cuenta (vacaciones, cambio de cargo): son los «usuarios sin actividad».
      const deja = azar() < 0.14 ? entre(31, 85) : 0
      const desde = Math.min(89, Math.floor((hoy.getTime() - (u.createdAt as Date).getTime()) / DIA))
      const fin = u.status === 'blocked' ? Math.floor((hoy.getTime() - (u.blockedAt as Date).getTime()) / DIA) + 1 : Math.max(silencio, deja)
      const agente = uno(NAVEGADORES)
      let ultimo: { en: Date; ip: string } | null = null
      for (let d = desde; d >= fin; d--) {
        const diaSemana = new Date(hoy.getTime() - d * DIA).getUTCDay()
        const factor = diaSemana === 0 ? 0.1 : diaSemana === 6 ? 0.35 : 1
        if (azar() > ganas * factor) continue
        const en = enHorario(d)
        const ip = ipDe()
        const lugar = { pais, ciudad: p.ciudad, metodo: extras.has('sso') && azar() < 0.7 ? 'sso' : u.mfaEnabled ? 'clave_y_mfa' : 'clave' }
        if (azar() < 0.05)
          evento({ tenantId, tipo: 'user.failed_login', en: new Date(en.getTime() - 60_000), actorType: 'anonymous', userId: u.id, metadata: { ...lugar, correo: u.email, motivo: 'clave_incorrecta' }, ip, agente })
        evento({ tenantId, tipo: 'user.login', en, actorId: u.id, userId: u.id, metadata: lugar, ip, agente })
        if (!ultimo || en > ultimo.en) ultimo = { en, ip }
      }
      // Antes de los 90 días también entraba: queda solo la fecha del último ingreso, sin el detalle.
      if (!ultimo && fin > 89 && desde >= 89) ultimo = { en: enHorario(fin + entre(0, 20)), ip: ipDe() }
      if (ultimo) {
        u.lastLoginAt = ultimo.en
        u.lastLoginIp = ultimo.ip
      }
    }

    // ── Facturas ──
    if (mrr > 0 || p.estado === 'cancelled') {
      const meses = Math.min(12, Math.floor(p.edad / 30))
      const monto = mrr || PLANES[p.plan].precio
      for (let m = meses; m >= 1; m--) {
        const emitida = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - m + (proximoCobro && proximoCobro.getUTCMonth() !== hoy.getUTCMonth() ? 1 : 0), creado.getUTCDate(), 12))
        if (emitida < creado || emitida > ahora) continue
        const ultima = m === 1
        let estado: EstadoFactura = 'paid'
        let motivo: string | null = null
        if (p.pago === 'failed' && (ultima || (p.estado === 'suspended' && m <= 3))) {
          estado = 'failed'
          motivo = 'Tarjeta rechazada: fondos insuficientes'
        } else if (p.pago === 'past_due' && ultima) estado = 'past_due'
        else if (p.estado === 'cancelled' && m <= 3) estado = 'cancelled'
        const facturaId = id('inv')
        filasFacturas.push({
          id: facturaId,
          tenantId,
          number: `F-${emitida.getUTCFullYear()}-${String(folio++).padStart(5, '0')}`,
          periodStart: emitida,
          amount: monto,
          status: estado,
          issuedAt: emitida,
          dueAt: new Date(emitida.getTime() + 10 * DIA),
          paidAt: estado === 'paid' ? new Date(emitida.getTime() + entre(0, 6) * DIA) : null,
          failureReason: motivo,
        })
        if (estado === 'paid') evento({ tenantId, tipo: 'billing.payment_succeeded', en: new Date(emitida.getTime() + 3_600_000), targetId: facturaId, targetType: 'invoice', metadata: { monto } })
        if (estado === 'failed')
          evento({ tenantId, tipo: 'billing.payment_failed', en: new Date(emitida.getTime() + 3_600_000), targetId: facturaId, targetType: 'invoice', metadata: { monto, motivo, intento: 1 } })
      }
      if (p.estado === 'cancelled') evento({ tenantId, tipo: 'billing.subscription_cancelled', en: enHorario(silencio - 5), actorId: dueno, metadata: { motivo: 'Cambio a otro sistema' } })
    }
    if (p.estado === 'suspended') evento({ tenantId, tipo: 'tenant.suspended', en: enHorario(20), actorId: camila.id, actorType: 'platform_admin', targetId: tenantId, targetType: 'tenant', metadata: { antes: 'past_due', despues: 'suspended', motivo: 'Tres cobros fallidos sin respuesta a los avisos' } })
    if (p.estado === 'cancelled') evento({ tenantId, tipo: 'tenant.cancelled', en: enHorario(silencio - 5), actorId: camila.id, actorType: 'platform_admin', targetId: tenantId, targetType: 'tenant', metadata: { antes: 'active', despues: 'cancelled', motivo: 'El cliente pidió la baja' } })
    if (p.plan === 'pro' && p.edad > 200)
      evento({ tenantId, tipo: 'tenant.plan_changed', en: enHorario(entre(60, p.edad - 30)), actorId: valentina.id, actorType: 'platform_admin', targetId: tenantId, targetType: 'tenant', metadata: { antes: { plan: 'starter', mrr: PLANES.starter.precio }, despues: { plan: 'pro', mrr: PLANES.pro.precio }, motivo: 'Subió de plan por cantidad de usuarios' } })

    // ── El taller: clientes, OT, trabajos por sección y cotizaciones de verdad ──
    const taller = sembrarTaller(
      { azar, entre, uno, id },
      { tenantId, creado, hoy, ahora, silencio, nunca: Boolean(p.nunca), actividad: p.actividad, personas: misUsuarios.map((u) => ({ id: u.id, role: u.role, status: u.status })) },
      evento,
    )
    filasSecciones.push(...taller.secciones)
    filasTrabajos.push(...taller.trabajos)
    filasClientes.push(...taller.clientes)
    filasOts.push(...taller.ots)
    filasTareas.push(...taller.tareas)
    filasEspecialistas.push(...taller.especialistas)
    filasDetenciones.push(...taller.detenciones)
    filasProveedores.push(...taller.proveedores)
    filasMaquinas.push(...taller.maquinas)
    filasInsumos.push(...taller.insumos)
    filasMovimientos.push(...taller.movimientosInsumo)
    filasUsosMaquinas.push(...taller.usosMaquinas)
    filasParadas.push(...taller.paradas)
    filasOrdenes.push(...taller.ordenes)
    filasRepuestos.push(...taller.repuestos)
    filasCotizaciones.push(...taller.cotizaciones)

    // Una pieza propia, para mostrarla: Los Andes también repara turbos (sin sorteos: no cambia el resto de la demostración).
    const terceros = taller.secciones.find((s) => s.name === 'Servicios de terceros')
    if (slug === 'los-andes' && terceros) {
      const turbo = `pz_${tenantId.slice(3)}t`
      filasPiezas.push({ id: turbo, tenantId, name: 'Turbo', position: 0, active: true, createdAt: creado })
      filasTrabajos.push({ id: `srv_${tenantId.slice(3)}t`, tenantId, sectionId: terceros.id, code: 'T-04', name: 'Reparación de turbo', unit: 'turbo', criterion: 'fixed', price: 180_000, stdHours: 0, piece: turbo, step: 100, typical: true, active: true })
    }

    // ── Uso diario: las OT, cotizaciones y documentos salen del taller; la API y el almacenamiento, del perfil ──
    const limites = PLANES[p.plan].limites
    const ritmoApi = (limites.api_calls_month / 30) * (0.15 + azar() * 0.35)
    const vida = Math.min(90, p.edad)
    // Hoy también, con la parte del día que va corrida: el mes en curso cuenta las OT recibidas hoy.
    const corrido = (ahora.getTime() - hoy.getTime()) / DIA
    for (let d = vida; d >= 0; d--) {
      const diaSemana = new Date(hoy.getTime() - d * DIA).getUTCDay()
      const activo = !p.nunca && d >= silencio
      const factor = activo ? (diaSemana === 0 ? 0.15 : diaSemana === 6 ? 0.4 : 1) * (0.75 + azar() * 0.5) * (d === 0 ? corrido : 1) : 0
      let api = Math.round(ritmoApi * factor)
      if (extras.has('pico') && d === 1) api *= 7
      const delDia = taller.porDia.get(new Date(hoy.getTime() - d * DIA).toISOString().slice(0, 10)) ?? { ots: 0, cotizaciones: 0, documentos: 0 }
      const ots = delDia.ots
      const cotizaciones = delDia.cotizaciones
      const progreso = 1 - d / Math.max(vida, 1)
      const features: Partial<Record<UsoClave, number>> = { work_orders: ots, quotes: cotizaciones }
      if (activo && usaPortal) features.client_portal = Math.round(entre(0, 25) * factor)
      if (activo && usaInventario) features.inventory = Math.round(entre(0, 40) * factor)
      if (activo && azar() < 0.3) features.reports = entre(1, 6)
      if (activo && usaApi) features.api = Math.round(api * 0.4)
      filasUso.push({
        tenantId,
        day: new Date(hoy.getTime() - d * DIA).toISOString().slice(0, 10),
        apiCalls: api,
        storageMb: Math.round(limites.storage_mb * p.almacenamiento * (0.7 + 0.3 * progreso)),
        workOrders: ots,
        quotes: cotizaciones,
        documents: delDia.documentos,
        messages: Math.round(ots * azar() * 4),
        features,
      })
    }

    // ── Integraciones y claves ──
    if (extras.has('sso'))
      filasIntegraciones.push({ id: id('int'), tenantId, kind: 'sso', name: 'Inicio de sesión corporativo', target: uno(['Microsoft Entra ID', 'Google Workspace']), status: 'active', lastSuccessAt: haceHoras(entre(1, 20)), createdAt: new Date(creado.getTime() + 20 * DIA) })
    if (extras.has('webhook') || extras.has('api') || azar() < 0.3) {
      const falla = extras.has('webhook')
      const estado: EstadoIntegracion = falla ? 'failing' : 'active'
      filasIntegraciones.push({
        id: id('int'),
        tenantId,
        kind: 'webhook',
        name: 'Aviso de OT terminada al ERP',
        target: `https://hooks.${slug}.test/ot-terminada`,
        status: estado,
        lastSuccessAt: haceHoras(falla ? entre(30, 60) : entre(1, 8)),
        lastFailureAt: falla ? haceHoras(0.5) : null,
        lastError: falla ? 'HTTP 503 Service Unavailable (3 reintentos)' : null,
        createdAt: new Date(creado.getTime() + 40 * DIA),
      })
    }
    if (p.plan !== 'free' && azar() < 0.4)
      filasIntegraciones.push({ id: id('int'), tenantId, kind: 'accounting', name: 'Sistema contable', target: 'Proveedor contable (API)', status: 'active', lastSuccessAt: haceHoras(entre(2, 30)), createdAt: new Date(creado.getTime() + 15 * DIA) })
    if (usaApi) {
      for (let k = 0; k < entre(1, 3); k++) {
        const claveId = id('key')
        const creada = enHorario(entre(10, Math.min(300, p.edad)))
        const revocada = k === 0 && azar() < 0.5 ? enHorario(entre(1, 9)) : null
        filasClaves.push({ id: claveId, tenantId, name: uno(['Integración ERP', 'Bodega', 'Panel de gerencia', 'Script de respaldo']), prefix: `rk_live_${claveId.slice(4, 8)}`, createdBy: dueno, createdAt: creada, lastUsedAt: revocada ? null : haceHoras(entre(1, 72)), revokedAt: revocada })
        evento({ tenantId, tipo: 'api_key.created', en: creada, actorId: dueno, userId: dueno, targetId: claveId, targetType: 'api_key', ip: uno(oficinas), agente: NAVEGADORES[0] })
        if (revocada) evento({ tenantId, tipo: 'api_key.revoked', en: revocada, actorId: dueno, userId: dueno, targetId: claveId, targetType: 'api_key', ip: uno(oficinas), agente: NAVEGADORES[0] })
      }
    }
    if (extras.has('exporta') || azar() < 0.25)
      for (let k = 0; k < (extras.has('exporta') ? 4 : 1); k++)
        evento({ tenantId, tipo: 'data.exported', en: enHorario(entre(0, 40)), actorId: dueno, userId: dueno, metadata: { que: uno(['Órdenes de trabajo', 'Clientes', 'Cotizaciones', 'Inventario']), formato: 'xlsx', filas: entre(200, 9000) }, ip: uno(oficinas), agente: NAVEGADORES[0] })

    // ── Los problemas de cada perfil ──
    if (extras.has('ataque')) {
      // Unas 40 claves probadas en la madrugada contra tres cuentas, desde dos IPs extranjeras.
      const victimas = misUsuarios.filter((u) => u.status === 'active').slice(0, 3)
      const atacantes = [`${entre(80, 95)}.${entre(10, 250)}.${entre(0, 255)}.${entre(2, 254)}`, `${entre(100, 120)}.${entre(10, 250)}.${entre(0, 255)}.${entre(2, 254)}`]
      for (let k = 0; k < 42; k++) {
        const v = victimas[k % victimas.length]
        evento({ tenantId, tipo: 'user.failed_login', en: haceHoras(9 - k * 0.1), actorType: 'anonymous', userId: v.id, metadata: { correo: v.email, motivo: 'clave_incorrecta', pais: k % 2 ? 'Rumania' : 'Vietnam', ciudad: null }, ip: atacantes[k % 2], agente: 'python-requests/2.32' })
      }
    }
    if (extras.has('webhook'))
      for (let k = 0; k < 7; k++) evento({ tenantId, tipo: 'system.webhook_failed', en: haceHoras(k * 3 + 0.5), metadata: { url: `https://hooks.${slug}.test/ot-terminada`, respuesta: 503, intentos: 3 } })
    if (extras.has('job')) evento({ tenantId, tipo: 'system.job_failed', en: haceHoras(4), metadata: { tarea: 'Envío nocturno de cotizaciones vencidas', error: 'Timeout del servidor de correo' } })
    if (extras.has('critico')) {
      evento({ tenantId, tipo: 'system.error', severidad: 'critical', en: haceHoras(5), actorId: dueno, userId: dueno, metadata: { ruta: '/api/cotizaciones/pdf', mensaje: 'Sin memoria al generar el PDF de la cotización (documento de 412 páginas)' } })
      evento({ tenantId, tipo: 'system.error', en: haceHoras(30), metadata: { ruta: '/api/inventario/importar', mensaje: 'El archivo CSV trae columnas que no se reconocen' } })
    }
    if (extras.has('cross')) {
      const intruso = misUsuarios.find((u) => u.role === 'admin' && u.status === 'active')!
      evento({ tenantId, tipo: 'security.cross_tenant_access_attempt', severidad: 'critical', en: haceHoras(40), actorId: intruso.id, userId: intruso.id, targetType: 'user', metadata: { metodo: 'POST', ruta: '/api/organizacion/usuarios/(de otro cliente)/bloqueo', motivo: 'recurso_de_otro_tenant' }, ip: uno(oficinas), agente: NAVEGADORES[1] })
    }
  }

  // El intento del perfil «cross» apunta a un usuario real de otro cliente.
  const losAndes = filasTenants.find((t) => t.name === 'Rectificadora Los Andes')!
  const intento = listaEventos.find((e) => e.eventType === 'security.cross_tenant_access_attempt')
  if (intento) {
    const objetivo = usuariosDe.get(losAndes.id)![3]
    intento.targetId = objetivo
    intento.metadata = { ...intento.metadata, tenant_objetivo: losAndes.id, ruta: `/api/organizacion/usuarios/${objetivo}/bloqueo` }
  }

  // ── Impersonaciones de soporte ya cerradas, con sus eventos ──
  const soporte = [
    { admin: matias, tenant: 'Rectificadora Biobío', dias: 6, minutos: 35, motivo: 'Ticket 4821: el cliente no ve las OT cerradas en el informe mensual' },
    { admin: valentina, tenant: 'Diesel Norte Antofagasta', dias: 12, minutos: 18, motivo: 'Revisar con el cliente la configuración de cobro antes del reintento' },
    { admin: matias, tenant: 'Rectificadora Austral', dias: 2, minutos: 22, motivo: 'Ticket 4907: webhook de OT terminada devuelve error 503' },
  ]
  for (const s of soporte) {
    const t = filasTenants.find((x) => x.name === s.tenant)!
    const usuario = admins.get(t.id)!
    const inicio = enHorario(s.dias)
    const fin = new Date(inicio.getTime() + s.minutos * 60_000)
    const impId = id('imp')
    const ipEquipo = `10.20.${entre(0, 9)}.${entre(2, 250)}`
    filasImpersonaciones.push({ id: impId, adminId: s.admin.id, tenantId: t.id, userId: usuario, reason: s.motivo, adminIp: ipEquipo, userAgent: NAVEGADORES[0], startedAt: inicio, expiresAt: new Date(inicio.getTime() + 3_600_000), endedAt: fin })
    const comun = { tenantId: t.id, actorId: s.admin.id, actorType: 'platform_admin' as const, userId: usuario, targetId: impId, targetType: 'impersonation', ip: ipEquipo, agente: NAVEGADORES[0] }
    evento({ ...comun, tipo: 'support.impersonation_started', en: inicio, severidad: 'warning', metadata: { motivo: s.motivo, admin_nombre: s.admin.name } })
    evento({ ...comun, tipo: 'support.impersonation_ended', en: fin, metadata: { duracion_min: s.minutos } })
  }

  // ── Fallas de la plataforma misma (sin cliente) ──
  evento({ tenantId: null, tipo: 'system.job_failed', en: haceHoras(3), metadata: { tarea: 'Sincronización de pagos con el procesador', error: 'El procesador respondió 502 en 3 intentos' } })
  evento({ tenantId: null, tipo: 'system.error', severidad: 'critical', en: haceHoras(31), metadata: { ruta: 'réplica de lectura', mensaje: 'La réplica de lectura quedó 14 minutos atrasada; las consultas pasaron a la base principal' } })
  evento({ tenantId: null, tipo: 'system.error', en: haceHoras(52), metadata: { ruta: '/api/correo', mensaje: 'El proveedor de correo rechazó 23 envíos por límite de velocidad' } })

  await base.transaction(async (tx) => {
    await enLotes(tx, tenants, filasTenants)
    await enLotes(tx, users, filasUsuarios)
    await enLotes(tx, invoices, filasFacturas)
    await enLotes(tx, usageDaily, filasUso)
    await enLotes(tx, apiKeys, filasClaves)
    await enLotes(tx, integrations, filasIntegraciones)
    await enLotes(tx, impersonations, filasImpersonaciones)
    await enLotes(tx, shopSections, filasSecciones)
    await enLotes(tx, customPieces, filasPiezas)
    await enLotes(tx, services, filasTrabajos)
    await enLotes(tx, customers, filasClientes)
    await enLotes(tx, workOrders, filasOts)
    await enLotes(tx, workOrderTasks, filasTareas)
    await enLotes(tx, serviceSpecialists, filasEspecialistas)
    await enLotes(tx, taskHolds, filasDetenciones)
    await enLotes(tx, suppliers, filasProveedores)
    await enLotes(tx, supplies, filasInsumos)
    await enLotes(tx, supplyMovements, filasMovimientos)
    await enLotes(tx, machines, filasMaquinas)
    await enLotes(tx, machineServices, filasUsosMaquinas)
    await enLotes(tx, machineStops, filasParadas)
    await enLotes(tx, purchaseOrders, filasOrdenes)
    await enLotes(tx, workOrderParts, filasRepuestos)
    await enLotes(tx, quotes, filasCotizaciones, 200)
    await enLotes(tx, events, listaEventos, 300)
  })
  return true
}
