// Lo que comparten las rutas del sistema de cada rectificadora: quién puede qué, los folios por cliente, el uso que
// alimenta la consola de la plataforma y el estado calculado de una OT.
import { and, eq, getTableName, gte, max, sql } from 'drizzle-orm'
import type { Context } from 'hono'
import type { Base } from '../../base'
import { rechazo } from '../../http'
import type { EntornoTenant } from '../acceso/guardias'
import { quotes } from '../comercial/tablas'
import { diaDe } from '../plataforma/panorama'
import { limitesDe, type UsoClave } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import { usageDaily } from '../uso/tablas'
import type { RolTenant } from '../usuarios/reglas'
import { nuevoId } from '../../ids'
import { estadoDeOt, type Motor, MOTOR_POR_OMISION, SECCIONES_INICIALES, TRABAJOS_INICIALES } from './reglas'
import { shopSections, workOrders, workOrderTasks } from './tablas'

/** Recibe, cotiza, asigna, aprueba calidad y entrega: el jefe de taller y el administrador. */
export const gestiona = (rol: RolTenant) => rol === 'admin' || rol === 'planner'
/** El técnico no ve montos ni cotizaciones (como en el ERP de Baufer: el taller no ve lo comercial). */
export const veMontos = (rol: RolTenant) => rol !== 'technician'

export function exigirGestion(c: Context<EntornoTenant>) {
  if (c.var.actor.estadoTenant === 'suspended' || c.var.actor.estadoTenant === 'cancelled')
    throw rechazo(403, 'Tu organización está suspendida: puedes revisar, pero no hacer cambios.')
  if (!gestiona(c.var.actor.rol)) throw rechazo(403, 'Esto lo hace el jefe de taller o el administrador.')
}

export function exigirMontos(c: Context<EntornoTenant>) {
  if (!veMontos(c.var.actor.rol)) throw rechazo(403, 'Tu rol no ve cotizaciones ni montos.')
}

/**
 * El número que sigue en la serie del cliente (OT-1, OT-2…). Un cerrojo por tabla y cliente, dentro de la transacción:
 * si dos personas crean a la vez, la segunda espera y toma el siguiente.
 */
export async function siguienteNumero(tx: Base, tabla: typeof workOrders | typeof quotes, tenantId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${getTableName(tabla)}:${tenantId}`}))`)
  const [{ ultimo }] = await tx.select({ ultimo: max(tabla.number) }).from(tabla).where(eq(tabla.tenantId, tenantId))
  return (ultimo ?? 0) + 1
}

type Cambios = { apiCalls?: number; workOrders?: number; quotes?: number; documents?: number; features?: Partial<Record<UsoClave, number>> }

/**
 * Suma al uso del día del cliente: es lo que la consola de la plataforma mide (consumo del plan, salud, alertas). El
 * día nuevo hereda el almacenamiento del anterior.
 */
export async function sumarUso(base: Base, tenantId: string, ahora: Date, c: Cambios) {
  const features = Object.entries(c.features ?? {}) as [UsoClave, number][]
  const mezcla = features.reduce(
    (acum, [clave, n]) => sql`${acum} || jsonb_build_object(${clave}::text, coalesce((${usageDaily.features}->>${clave}::text)::int, 0) + ${n}::int)`,
    sql`${usageDaily.features}`,
  )
  await base
    .insert(usageDaily)
    .values({
      tenantId,
      day: diaDe(ahora),
      apiCalls: c.apiCalls ?? 0,
      workOrders: c.workOrders ?? 0,
      quotes: c.quotes ?? 0,
      documents: c.documents ?? 0,
      storageMb: sql`coalesce((select u.storage_mb from usage_daily u where u.tenant_id = ${tenantId} order by u.day desc limit 1), 0)`,
      features: Object.fromEntries(features),
    })
    .onConflictDoUpdate({
      target: [usageDaily.tenantId, usageDaily.day],
      set: {
        apiCalls: sql`${usageDaily.apiCalls} + ${c.apiCalls ?? 0}`,
        workOrders: sql`${usageDaily.workOrders} + ${c.workOrders ?? 0}`,
        quotes: sql`${usageDaily.quotes} + ${c.quotes ?? 0}`,
        documents: sql`${usageDaily.documents} + ${c.documents ?? 0}`,
        features: mezcla,
      },
    })
}

/** Que el plan alcance para una OT más este mes. Si no, se avisa antes de recibir el motor. */
export async function exigirCupoDeOt(base: Base, tenantId: string, ahora: Date) {
  const [t] = await base.select({ plan: tenants.plan, ajustes: tenants.limitsOverride }).from(tenants).where(eq(tenants.id, tenantId))
  const limite = limitesDe(t.plan, t.ajustes).work_orders_month
  const [{ usadas }] = await base
    .select({ usadas: sql<number>`coalesce(sum(${usageDaily.workOrders}), 0)`.mapWith(Number) })
    .from(usageDaily)
    .where(and(eq(usageDaily.tenantId, tenantId), gte(usageDaily.day, `${diaDe(ahora).slice(0, 7)}-01`)))
  if (usadas >= limite) throw rechazo(409, `Llegaste al límite de tu plan: ${limite} órdenes de trabajo al mes. Pide al administrador ampliarlo.`)
}

/** Los datos del motor de una OT o cotización; lo que falta, con lo más común. */
export const motorDe = (x: { cylinders: number | null; valvesPerCylinder: number | null; heads: number | null }): Motor => ({
  cilindros: x.cylinders ?? MOTOR_POR_OMISION.cilindros,
  valvulasPorCilindro: x.valvesPerCylinder ?? MOTOR_POR_OMISION.valvulasPorCilindro,
  culatas: x.heads ?? MOTOR_POR_OMISION.culatas,
})

/** Recalcula y guarda el estado de la OT a partir de sus tareas y su cotización. */
export async function recalcularOt(tx: Base, otId: string) {
  const [ot] = await tx.select().from(workOrders).where(eq(workOrders.id, otId))
  const tareas = await tx
    .select({ estado: workOrderTasks.status, tipo: shopSections.kind })
    .from(workOrderTasks)
    .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
    .where(eq(workOrderTasks.workOrderId, otId))
  const [cotizacion] = ot.quoteId ? await tx.select({ estado: quotes.status }).from(quotes).where(eq(quotes.id, ot.quoteId)) : []
  const estado = estadoDeOt({
    anulada: Boolean(ot.cancelledAt),
    entregada: Boolean(ot.deliveredAt),
    calidadAprobada: Boolean(ot.qcApprovedAt),
    tareas: tareas.map((t) => ({ diagnostico: t.tipo === 'diagnosis', estado: t.estado })),
    cotizacion: cotizacion?.estado ?? null,
  })
  if (estado !== ot.status) await tx.update(workOrders).set({ status: estado }).where(eq(workOrders.id, otId))
  return estado
}

/**
 * Las secciones y la lista de trabajos con que nace el taller de un cliente nuevo. `id` y `factor` los cambia la
 * siembra de demostración (ids con semilla, precios algo distintos en cada taller).
 */
export function tallerInicial(tenantId: string, id: (prefijo: string) => string = nuevoId, factor: (codigo: string) => number = () => 1) {
  const secciones = SECCIONES_INICIALES.map((s, i) => ({ id: id('sec'), tenantId, name: s.nombre, kind: s.clave === 'diagnostico' ? ('diagnosis' as const) : ('work' as const), position: i, active: true }))
  const porClave = new Map(SECCIONES_INICIALES.map((s, i) => [s.clave, secciones[i].id]))
  const trabajos = TRABAJOS_INICIALES.map((t) => ({
    id: id('srv'),
    tenantId,
    sectionId: porClave.get(t.seccion)!,
    code: t.codigo,
    name: t.nombre,
    unit: t.unidad,
    criterion: t.criterio,
    price: t.precio === null ? null : Math.round((t.precio * factor(t.codigo)) / 500) * 500,
    stdHours: t.horas,
    piece: t.pieza,
    step: t.paso,
    typical: t.tipico,
    active: true,
  }))
  return { secciones, trabajos }
}
