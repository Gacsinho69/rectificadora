// El estado de cada cliente en una sola pasada: usuarios, ingresos, errores y uso, agregados por tenant, más su salud
// y sus alertas. Lo usan el resumen, la lista de clientes, las alertas y la ficha. Cuatro consultas agrupadas en total,
// sin importar cuántos clientes haya; el filtrado y el orden de la lista se hacen después, sobre este resultado.
import { and, eq, gte, isNotNull, isNull, max, type SQL, sql } from 'drizzle-orm'
import type { Base } from '../../base'
import { type Alerta, alertasDePlataforma, alertasDeTenant, ordenarAlertas } from '../alertas/reglas'
import { events } from '../eventos/tablas'
import { calcularSalud, type Salud } from '../salud/reglas'
import { type EstadoPago, type EstadoTenant, LIMITES, type Limites, limitesDe, type Plan, type Region, USOS_CLAVE, type UsoClave } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import { usageDaily } from '../uso/tablas'
import { users } from '../usuarios/tablas'

export const DIA = 86_400_000
export const hace = (ahora: Date, dias: number) => new Date(ahora.getTime() - dias * DIA)
/** Las fechas van como texto con su tipo: así PGlite y PostgreSQL las reciben igual. */
export const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`
export const diaDe = (d: Date) => d.toISOString().slice(0, 10)
export const cuenta = (condicion: SQL) => sql<number>`count(*) filter (where ${condicion})`.mapWith(Number)
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)

export type Uso = { clave: keyof Limites; nombre: string; usado: number; limite: number; fraccion: number }

export type ResumenTenant = {
  id: string
  nombre: string
  slug: string
  estado: EstadoTenant
  plan: Plan
  region: Region
  creado: string
  correoFacturacion: string
  estadoPago: EstadoPago
  mrr: number
  trialVence: string | null
  proximoCobro: string | null
  usuarios: { total: number; activos30d: number; activos7d: number; activos24h: number; invitados: number; bloqueados: number }
  ultimoLogin: string | null
  diasSinLogin: number | null
  logins7d: number
  fallidos24h: number
  errores7d: number
  erroresCriticos24h: number
  webhooksFallidos24h: number
  jobsFallidos24h: number
  crossTenant7d: number
  usos: Uso[]
  usoMaximo: number
  apiAyer: number
  apiMediana14d: number
  funcionesUsadas: UsoClave[]
  /** Un cliente cancelado no tiene salud que cuidar. */
  salud: Salud | null
  alertas: Alerta[]
}

const mediana = (valores: number[]) => {
  if (!valores.length) return 0
  const v = [...valores].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Los errores que cuentan para la salud y las alertas. */
const esFalla = sql`${events.eventType} in ('system.error', 'system.job_failed', 'system.webhook_failed')`

export async function panorama(base: Base, ahora: Date, soloTenant?: string): Promise<ResumenTenant[]> {
  const h1 = hace(ahora, 1)
  const h7 = hace(ahora, 7)
  const h30 = hace(ahora, 30)

  const filas = await base.select().from(tenants).where(soloTenant ? eq(tenants.id, soloTenant) : undefined)
  if (!filas.length) return []

  const personas = await base
    .select({
      tenantId: users.tenantId,
      total: cuenta(sql`${users.status} <> 'invited'`),
      invitados: cuenta(sql`${users.status} = 'invited'`),
      bloqueados: cuenta(sql`${users.status} = 'blocked'`),
      activos30d: cuenta(sql`${users.lastLoginAt} >= ${ts(h30)}`),
      activos7d: cuenta(sql`${users.lastLoginAt} >= ${ts(h7)}`),
      activos24h: cuenta(sql`${users.lastLoginAt} >= ${ts(h1)}`),
      ultimo: max(users.lastLoginAt),
    })
    .from(users)
    .where(soloTenant ? eq(users.tenantId, soloTenant) : undefined)
    .groupBy(users.tenantId)

  const sucesos = await base
    .select({
      tenantId: events.tenantId,
      logins7d: cuenta(sql`${events.eventType} = 'user.login'`),
      fallidos24h: cuenta(sql`${events.eventType} = 'user.failed_login' and ${events.createdAt} >= ${ts(h1)}`),
      errores7d: cuenta(esFalla),
      erroresCriticos24h: cuenta(sql`${events.eventType} = 'system.error' and ${events.severity} = 'critical' and ${events.createdAt} >= ${ts(h1)}`),
      webhooksFallidos24h: cuenta(sql`${events.eventType} = 'system.webhook_failed' and ${events.createdAt} >= ${ts(h1)}`),
      jobsFallidos24h: cuenta(sql`${events.eventType} = 'system.job_failed' and ${events.createdAt} >= ${ts(h1)}`),
      crossTenant7d: cuenta(sql`${events.eventType} = 'security.cross_tenant_access_attempt'`),
    })
    .from(events)
    .where(and(gte(events.createdAt, h7), isNotNull(events.tenantId), soloTenant ? eq(events.tenantId, soloTenant) : undefined))
    .groupBy(events.tenantId)

  const usoDiario = await base
    .select()
    .from(usageDaily)
    .where(and(gte(usageDaily.day, diaDe(hace(ahora, 31))), soloTenant ? eq(usageDaily.tenantId, soloTenant) : undefined))

  const porTenant = <T extends { tenantId: string | null }>(lista: T[]) => new Map(lista.map((f) => [f.tenantId, f]))
  const personasDe = porTenant(personas)
  const sucesosDe = porTenant(sucesos)
  const usoDe = new Map<string, (typeof usoDiario)[number][]>()
  for (const u of usoDiario) usoDe.set(u.tenantId, [...(usoDe.get(u.tenantId) ?? []), u])

  const inicioMes = `${diaDe(ahora).slice(0, 7)}-01`
  const ayer = diaDe(h1)
  const desde14 = diaDe(hace(ahora, 15))
  const desde30 = diaDe(h30)
  const claves = Object.keys(USOS_CLAVE) as UsoClave[]

  return filas.map((t) => {
    const p = personasDe.get(t.id)
    const s = sucesosDe.get(t.id)
    const dias = (usoDe.get(t.id) ?? []).sort((a, b) => a.day.localeCompare(b.day))
    const delMes = dias.filter((d) => d.day >= inicioMes)
    const sumar = (lista: typeof dias, campo: 'apiCalls' | 'workOrders') => lista.reduce((suma, d) => suma + d[campo], 0)
    const limites = limitesDe(t.plan, t.limitsOverride)
    const usuarios = { total: p?.total ?? 0, activos30d: p?.activos30d ?? 0, activos7d: p?.activos7d ?? 0, activos24h: p?.activos24h ?? 0, invitados: p?.invitados ?? 0, bloqueados: p?.bloqueados ?? 0 }
    const usado: Limites = {
      // Una invitación ya ocupa su lugar en el plan.
      users: usuarios.total + usuarios.invitados,
      storage_mb: dias.at(-1)?.storageMb ?? 0,
      api_calls_month: sumar(delMes, 'apiCalls'),
      work_orders_month: sumar(delMes, 'workOrders'),
    }
    const usos: Uso[] = (Object.keys(LIMITES) as (keyof Limites)[]).map((clave) => ({
      clave,
      nombre: LIMITES[clave].nombre,
      usado: usado[clave],
      limite: limites[clave],
      fraccion: limites[clave] > 0 ? usado[clave] / limites[clave] : 0,
    }))
    const usoMaximo = Math.max(0, ...usos.map((u) => u.fraccion))
    const funcionesUsadas = claves.filter((k) => dias.some((d) => d.day >= desde30 && (d.features[k] ?? 0) > 0))
    const apiAyer = dias.find((d) => d.day === ayer)?.apiCalls ?? 0
    const apiMediana14d = mediana(dias.filter((d) => d.day >= desde14 && d.day < ayer).map((d) => d.apiCalls))
    const ultimo = p?.ultimo ?? null
    const diasSinLogin = ultimo ? Math.max(0, (ahora.getTime() - ultimo.getTime()) / DIA) : null
    const fallas = {
      logins7d: s?.logins7d ?? 0,
      fallidos24h: s?.fallidos24h ?? 0,
      errores7d: s?.errores7d ?? 0,
      erroresCriticos24h: s?.erroresCriticos24h ?? 0,
      webhooksFallidos24h: s?.webhooksFallidos24h ?? 0,
      jobsFallidos24h: s?.jobsFallidos24h ?? 0,
      crossTenant7d: s?.crossTenant7d ?? 0,
    }
    const salud =
      t.status === 'cancelled'
        ? null
        : calcularSalud({
            diasSinLogin,
            usuariosTotal: usuarios.total,
            usuariosActivos7d: usuarios.activos7d,
            funcionesUsadas: funcionesUsadas.length,
            funcionesTotal: claves.length,
            estadoPago: t.billingStatus,
            errores7d: fallas.errores7d,
            usoMaximo,
            diasDeVida: (ahora.getTime() - t.createdAt.getTime()) / DIA,
          })
    const alertas = alertasDeTenant(
      {
        tenantId: t.id,
        nombre: t.name,
        estado: t.status,
        estadoPago: t.billingStatus,
        creado: t.createdAt,
        trialVence: t.trialEndsAt,
        diasSinLogin,
        usos: usos.map((u) => ({ nombre: u.nombre, fraccion: u.fraccion })),
        ...fallas,
        apiAyer,
        apiMediana14d,
      },
      ahora,
    )
    return {
      id: t.id,
      nombre: t.name,
      slug: t.slug,
      estado: t.status,
      plan: t.plan,
      region: t.region,
      creado: t.createdAt.toISOString(),
      correoFacturacion: t.billingEmail,
      estadoPago: t.billingStatus,
      mrr: t.mrr,
      trialVence: iso(t.trialEndsAt),
      proximoCobro: iso(t.nextBillingAt),
      usuarios,
      ultimoLogin: iso(ultimo),
      diasSinLogin,
      ...fallas,
      usos,
      usoMaximo,
      apiAyer,
      apiMediana14d,
      funcionesUsadas,
      salud,
      alertas,
    }
  })
}

/** Las fallas de la plataforma que no son de ningún cliente, convertidas en alertas. */
export async function alertasGlobales(base: Base, ahora: Date): Promise<Alerta[]> {
  const h1 = hace(ahora, 1)
  const [p] = await base
    .select({
      erroresCriticos24h: cuenta(sql`${events.eventType} = 'system.error' and ${events.severity} = 'critical'`),
      jobsFallidos24h: cuenta(sql`${events.eventType} = 'system.job_failed'`),
      webhooksFallidos24h: cuenta(sql`${events.eventType} = 'system.webhook_failed'`),
    })
    .from(events)
    .where(and(gte(events.createdAt, h1), isNull(events.tenantId)))
  return alertasDePlataforma(p ?? { erroresCriticos24h: 0, jobsFallidos24h: 0, webhooksFallidos24h: 0 })
}

/** Todas las alertas, de los clientes y de la plataforma, de la más grave a la más leve. */
export const todasLasAlertas = async (base: Base, ahora: Date, resumenes: ResumenTenant[]) =>
  ordenarAlertas([...(await alertasGlobales(base, ahora)), ...resumenes.flatMap((r) => r.alertas)])
