// El reparto del trabajo del taller: la situación de cada trabajo en la ruta de su pieza, la carga de cada sección y de
// cada persona, y a quién va cada trabajo nuevo (a un especialista de su actividad). Las reglas están en `reglas.ts`
// (sin servidor); aquí, las consultas. Todo filtra por el tenant que recibe.
import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { Base } from '../../base'
import { customers } from '../comercial/tablas'
import { users } from '../usuarios/tablas'
import { anteriores, diasDeCola, type EstadoOt, type MotivoDetencion, responsableDe, type Situacion, situacionDe, type TrabajoEnRuta } from './reglas'
import { services, serviceSpecialists, shopSections, taskHolds, workOrders, workOrderTasks } from './tablas'

/** Las OT cuyos trabajos están en el taller: las listas, entregadas y anuladas ya no tienen nada que hacer. */
export const OT_EN_TALLER: EstadoOt[] = ['received', 'diagnosis', 'waiting_approval', 'in_progress']

type Fila = { t: typeof workOrderTasks.$inferSelect; detencion: { id: string | null; motivo: MotivoDetencion | null; nota: string | null; desde: Date | null; por: string | null } | null }

/** La detención abierta de cada trabajo, para unir a la consulta de trabajos. */
export const detencionAbierta = { id: taskHolds.id, motivo: taskHolds.reason, nota: taskHolds.note, desde: taskHolds.createdAt, por: taskHolds.createdBy }
export const unirDetencion = and(eq(taskHolds.taskId, workOrderTasks.id), isNull(taskHolds.resolvedAt))

/**
 * Cada trabajo con su situación en la ruta y, si espera su turno, los trabajos que espera. `filas` trae todos los
 * trabajos de cada OT que importan: los terminados no hacen esperar a nadie, así que pueden faltar.
 */
export function conSituacion<F extends Fila>(filas: F[]) {
  type EnRuta = TrabajoEnRuta & { nombre: string; posicion: number }
  const enRuta = (f: F): EnRuta => ({ id: f.t.id, nombre: f.t.name, posicion: f.t.position, pieza: f.t.piece, paso: f.t.step, estado: f.t.status, detenido: Boolean(f.detencion?.id), adelantado: Boolean(f.t.advancedAt) })
  const porOt = new Map<string, EnRuta[]>()
  for (const f of filas) {
    const lista = porOt.get(f.t.workOrderId) ?? []
    lista.push(enRuta(f))
    porOt.set(f.t.workOrderId, lista)
  }
  // En el orden de la ruta: lo que un trabajo espera se lee de lo primero a lo último.
  for (const lista of porOt.values()) lista.sort((a, b) => a.paso - b.paso || a.posicion - b.posicion)
  return filas.map((f) => {
    const deLaOt = porOt.get(f.t.workOrderId)!
    const yo = enRuta(f)
    const situacion: Situacion = situacionDe(yo, deLaOt)
    return { ...f, situacion, espera: situacion === 'waiting' ? anteriores(yo, deLaOt).map((u) => u.nombre) : [] }
  })
}

/** La detención como la ven las pantallas. */
export const detencionVisible = (d: Fila['detencion'], nombres: Map<string, string>) =>
  d?.id && d.motivo ? { motivo: d.motivo, nota: d.nota, desde: d.desde!.toISOString(), por: d.por ? (nombres.get(d.por) ?? null) : null } : null

/** Los trabajos sin terminar de las OT en el taller, con su situación, lo que esperan y su detención abierta. */
export async function trabajosAbiertos(base: Base, tenantId: string) {
  const filas = await base
    .select({
      t: workOrderTasks,
      ot: { id: workOrders.id, numero: workOrders.number, motor: workOrders.engine, entrega: workOrders.dueDate, prioridad: workOrders.priority, estado: workOrders.status },
      cliente: customers.name,
      seccion: shopSections.name,
      diagnostico: sql<boolean>`${shopSections.kind} = 'diagnosis'`,
      detencion: detencionAbierta,
    })
    .from(workOrderTasks)
    .innerJoin(workOrders, eq(workOrders.id, workOrderTasks.workOrderId))
    .innerJoin(customers, eq(customers.id, workOrders.customerId))
    .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
    .leftJoin(taskHolds, unirDetencion)
    .where(and(eq(workOrderTasks.tenantId, tenantId), ne(workOrderTasks.status, 'done'), inArray(workOrders.status, OT_EN_TALLER)))
  return conSituacion(filas)
}
export type TrabajoAbierto = Awaited<ReturnType<typeof trabajosAbiertos>>[number]

type Suma = { trabajos: number; enProceso: number; ahora: number; espera: number; detenidas: number; nDetenidas: number; sinAsignar: number }
const vacia = (): Suma => ({ trabajos: 0, enProceso: 0, ahora: 0, espera: 0, detenidas: 0, nDetenidas: 0, sinAsignar: 0 })
function sumar(s: Suma, f: TrabajoAbierto) {
  const minutos = f.t.stdMinutes
  s.trabajos++
  if (!f.t.assignedTo) s.sinAsignar++
  if (f.situacion === 'held') {
    s.detenidas += minutos
    s.nDetenidas++
  } else if (f.situacion === 'waiting') s.espera += minutos
  else {
    s.ahora += minutos
    if (f.situacion === 'in_progress') s.enProceso++
  }
}
/** En horas, para mostrar. */
const enHoras = (s: Suma) => ({ ...s, ahora: s.ahora / 60, espera: s.espera / 60, detenidas: s.detenidas / 60 })

/** La gente que puede tomar trabajos (activa y que no es solo lectura) y qué actividades hace cada una. */
export async function genteDelTaller(base: Base, tenantId: string) {
  const [personas, especialistas] = await Promise.all([
    base
      .select({ id: users.id, nombre: users.name, rol: users.role })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.status, 'active'), ne(users.role, 'viewer')))
      .orderBy(asc(users.name)),
    base.select({ servicioId: serviceSpecialists.serviceId, userId: serviceSpecialists.userId }).from(serviceSpecialists).where(eq(serviceSpecialists.tenantId, tenantId)),
  ])
  const activos = new Set(personas.map((p) => p.id))
  return { personas, especialistas: especialistas.filter((e) => activos.has(e.userId)) }
}

/**
 * La carga del taller: por sección y por persona, las horas para hacer ahora, las que esperan su turno y las
 * detenidas. La gente de una sección son los especialistas de sus actividades; con ellos se cuentan los días de cola.
 */
export async function cargaDelTaller(base: Base, tenantId: string, trabajos: TrabajoAbierto[]) {
  const [secciones, actividades, { personas, especialistas }] = await Promise.all([
    base.select().from(shopSections).where(and(eq(shopSections.tenantId, tenantId), eq(shopSections.active, true))).orderBy(asc(shopSections.position)),
    base.select({ id: services.id, seccionId: services.sectionId }).from(services).where(and(eq(services.tenantId, tenantId), eq(services.active, true))),
    genteDelTaller(base, tenantId),
  ])
  const nombre = new Map(personas.map((p) => [p.id, p.nombre]))
  const seccionDe = new Map(actividades.map((a) => [a.id, a.seccionId]))
  const porSeccion = new Map(secciones.map((s) => [s.id, vacia()]))
  const porPersona = new Map(personas.map((p) => [p.id, vacia()]))
  for (const f of trabajos) {
    const s = porSeccion.get(f.t.sectionId)
    if (s) sumar(s, f)
    const p = f.t.assignedTo ? porPersona.get(f.t.assignedTo) : undefined
    if (p) sumar(p, f)
  }
  /** Quién trabaja en cada sección: quien hace alguna de sus actividades. */
  const genteDe = (seccionId: string) => [...new Set(especialistas.filter((e) => seccionDe.get(e.servicioId) === seccionId).map((e) => e.userId))]
  return {
    secciones: secciones.map((s) => {
      const gente = genteDe(s.id).map((id) => ({ id, nombre: nombre.get(id)! })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      const suma = porSeccion.get(s.id)!
      return { id: s.id, nombre: s.name, diagnostico: s.kind === 'diagnosis', gente, ...enHoras(suma), dias: diasDeCola(suma.ahora + suma.espera, gente.length) }
    }),
    personas: personas.map((p) => {
      const suyas = especialistas.filter((e) => e.userId === p.id)
      const enSecciones = new Set(suyas.map((e) => seccionDe.get(e.servicioId)))
      return { ...p, actividades: suyas.length, secciones: secciones.filter((s) => enSecciones.has(s.id)).map((s) => s.name), ...enHoras(porPersona.get(p.id)!) }
    }),
  }
}

/**
 * Reparte los trabajos sin asignar de una OT (o solo los de una sección) entre los especialistas de cada actividad
 * (`responsableDe`): la misma persona para la pieza si también hace la actividad; si no, quien tenga menos horas
 * pendientes. Lo ya asignado no se toca.
 */
export async function repartirOt(tx: Base, tenantId: string, otId: string, seccionId?: string) {
  const deLaOt = await tx
    .select({ id: workOrderTasks.id, servicioId: workOrderTasks.serviceId, seccionId: workOrderTasks.sectionId, pieza: workOrderTasks.piece, asignado: workOrderTasks.assignedTo, estado: workOrderTasks.status, minutos: workOrderTasks.stdMinutes })
    .from(workOrderTasks)
    .where(and(eq(workOrderTasks.workOrderId, otId), eq(workOrderTasks.tenantId, tenantId)))
    .orderBy(asc(workOrderTasks.step), asc(workOrderTasks.position))
  const sinAsignar = deLaOt.filter((t) => !t.asignado && t.estado === 'pending' && t.servicioId && (!seccionId || t.seccionId === seccionId))
  if (!sinAsignar.length) return
  const { personas, especialistas } = await genteDelTaller(tx, tenantId)
  const nombre = new Map(personas.map((p) => [p.id, p.nombre]))
  const cargas = await tx
    .select({ id: workOrderTasks.assignedTo, minutos: sql<number>`coalesce(sum(${workOrderTasks.stdMinutes}), 0)`.mapWith(Number) })
    .from(workOrderTasks)
    .innerJoin(workOrders, eq(workOrders.id, workOrderTasks.workOrderId))
    .where(and(eq(workOrderTasks.tenantId, tenantId), ne(workOrderTasks.status, 'done'), inArray(workOrders.status, OT_EN_TALLER), isNotNull(workOrderTasks.assignedTo)))
    .groupBy(workOrderTasks.assignedTo)
  const minutos = new Map(cargas.map((c) => [c.id!, c.minutos]))
  for (const t of sinAsignar) {
    const gente = especialistas.filter((e) => e.servicioId === t.servicioId).map((e) => ({ id: e.userId, nombre: nombre.get(e.userId)!, minutos: minutos.get(e.userId) ?? 0 }))
    const quien = responsableDe(t, deLaOt, gente)
    if (!quien) continue
    // Queda anotado aquí mismo: el siguiente trabajo de la misma pieza va a la misma persona.
    t.asignado = quien
    minutos.set(quien, (minutos.get(quien) ?? 0) + t.minutos)
    await tx.update(workOrderTasks).set({ assignedTo: quien }).where(eq(workOrderTasks.id, t.id))
  }
}
