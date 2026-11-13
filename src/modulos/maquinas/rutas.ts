// Las máquinas de cada rectificadora: cuáles hay, a qué actividades sirven, si están operando y cuándo les toca
// mantención. Se monta dentro de `rutasTaller`, detrás de su guardia (solo personas del cliente, con su tenant de la
// sesión). Cualquiera que trabaje avisa que una máquina falló; el jefe de taller la vuelve a poner en operación.
import { and, asc, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { conDatos, rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { type EntornoTenant, exigirQuePuedaEditar, filaDelTenant, filasDelTenant } from '../acceso/guardias'
import { diaDe } from '../plataforma/panorama'
import { exigirGestion } from '../taller/comun'
import { OT_EN_TALLER } from '../taller/reparto'
import { services, shopSections, workOrders, workOrderTasks } from '../taller/tablas'
import { users } from '../usuarios/tablas'
import { mantencionDe, MOTIVOS_PARADA } from './reglas'
import { machines, machineServices, machineStops } from './tablas'

type C = Context<EntornoTenant>
const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]

const maquinaSchema = z.object({
  nombre: z.string({ error: 'Escribe el nombre de la máquina.' }).trim().min(2, 'Escribe el nombre de la máquina.').max(120),
  seccionId: z.string().nullable().optional(),
  actividades: z.array(z.string()).max(100).default([]),
  cadaDias: z.number().int().min(1, 'La mantención va cada un día o más.').max(3650).nullable().optional(),
  ultima: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  nota: z.string().trim().max(500).optional(),
  activa: z.boolean().optional(),
})

/** La sección y las actividades que nombra el pedido tienen que ser de la propia rectificadora. */
async function revisar(c: C, d: z.infer<typeof maquinaSchema>) {
  if (d.seccionId) await filaDelTenant(c, shopSections, d.seccionId, 'section', 'esa sección')
  await filasDelTenant(c, services, d.actividades, 'service', 'esa actividad')
}

const maquinaDe = (c: C) => filaDelTenant(c, machines, c.req.param('id') ?? '', 'machine', 'esa máquina')

export const rutasMaquinas = new Hono<EntornoTenant>()
  /** Las máquinas con su estado, sus actividades, los trabajos que las esperan y su mantención. */
  .get('/maquinas', async (c) => {
    const { base, actor, ahora } = c.var
    const hoy = diaDe(ahora)
    const [lista, usos, abiertas, pendientes, gente] = await Promise.all([
      base.select({ m: machines, seccion: shopSections.name }).from(machines).leftJoin(shopSections, eq(shopSections.id, machines.sectionId)).where(eq(machines.tenantId, actor.tenantId)).orderBy(desc(machines.active), asc(machines.name)),
      base.select({ maquina: machineServices.machineId, id: services.id, codigo: services.code, nombre: services.name }).from(machineServices).innerJoin(services, eq(services.id, machineServices.serviceId)).where(eq(machineServices.tenantId, actor.tenantId)).orderBy(asc(services.code)),
      base.select().from(machineStops).where(and(eq(machineStops.tenantId, actor.tenantId), isNull(machineStops.endedAt))),
      // Los trabajos por hacer de cada actividad, en OT que siguen en el taller.
      base
        .select({ servicio: workOrderTasks.serviceId, n: count() })
        .from(workOrderTasks)
        .innerJoin(workOrders, eq(workOrders.id, workOrderTasks.workOrderId))
        .where(and(eq(workOrderTasks.tenantId, actor.tenantId), ne(workOrderTasks.status, 'done'), inArray(workOrders.status, OT_EN_TALLER)))
        .groupBy(workOrderTasks.serviceId),
      base.select({ id: users.id, nombre: users.name }).from(users).where(eq(users.tenantId, actor.tenantId)),
    ])
    const nombre = new Map(gente.map((g) => [g.id, g.nombre]))
    const porHacer = new Map(pendientes.map((p) => [p.servicio, p.n]))
    return c.json(
      lista.map(({ m, seccion }) => {
        const suyas = usos.filter((u) => u.maquina === m.id)
        const parada = abiertas.find((p) => p.machineId === m.id)
        return {
          id: m.id,
          nombre: m.name,
          seccionId: m.sectionId,
          seccion,
          nota: m.notes,
          activa: m.active,
          actividades: suyas.map(({ id, codigo, nombre }) => ({ id, codigo, nombre })),
          trabajos: suyas.reduce((s, u) => s + (porHacer.get(u.id) ?? 0), 0),
          parada: parada ? { motivo: parada.reason, nota: parada.note, desde: parada.startedAt.toISOString(), por: parada.startedBy ? (nombre.get(parada.startedBy) ?? null) : null } : null,
          mantencion: { cadaDias: m.maintenanceEveryDays, ultima: m.lastMaintenanceAt, ...mantencionDe(m.lastMaintenanceAt, m.maintenanceEveryDays, hoy) },
        }
      }),
    )
  })

  /** Una máquina nueva, con las actividades que la necesitan. */
  .post('/maquinas', conDatos(maquinaSchema), async (c) => {
    exigirGestion(c)
    const d = c.req.valid('json')
    await revisar(c, d)
    const { actor, ahora } = c.var
    const id = nuevoId('maq')
    await c.var.base.transaction(async (tx) => {
      await tx.insert(machines).values({ id, tenantId: actor.tenantId, name: d.nombre, sectionId: d.seccionId ?? null, notes: d.nota || null, maintenanceEveryDays: d.cadaDias ?? null, lastMaintenanceAt: d.ultima ?? null, active: d.activa ?? true, createdAt: ahora })
      if (d.actividades.length) await tx.insert(machineServices).values([...new Set(d.actividades)].map((s) => ({ tenantId: actor.tenantId, machineId: id, serviceId: s })))
    })
    return c.json({ id })
  })

  /** Corregir una máquina: nombre, sección, actividades, mantención, o sacarla de uso. */
  .post('/maquinas/:id', conDatos(maquinaSchema), async (c) => {
    exigirGestion(c)
    const m = await maquinaDe(c)
    const d = c.req.valid('json')
    await revisar(c, d)
    const { tenantId } = c.var.actor
    await c.var.base.transaction(async (tx) => {
      await tx
        .update(machines)
        .set({ name: d.nombre, sectionId: d.seccionId ?? null, notes: d.nota || null, maintenanceEveryDays: d.cadaDias ?? null, lastMaintenanceAt: d.ultima === undefined ? m.lastMaintenanceAt : d.ultima, active: d.activa ?? m.active })
        .where(and(eq(machines.id, m.id), eq(machines.tenantId, tenantId)))
      await tx.delete(machineServices).where(and(eq(machineServices.machineId, m.id), eq(machineServices.tenantId, tenantId)))
      if (d.actividades.length) await tx.insert(machineServices).values([...new Set(d.actividades)].map((s) => ({ tenantId, machineId: m.id, serviceId: s })))
    })
    return c.json({ ok: true })
  })

  /**
   * Detener una máquina: en falla (cualquiera que trabaje lo avisa, con lo que le pasa) o en mantención. Mientras
   * esté detenida, los trabajos de sus actividades esperan.
   */
  .post('/maquinas/:id/detener', conDatos(z.object({ motivo: z.enum(claves(MOTIVOS_PARADA)), nota: z.string().trim().max(300).optional() })), async (c) => {
    exigirQuePuedaEditar(c)
    const m = await maquinaDe(c)
    if (!m.active) throw rechazo(409, 'Esa máquina está fuera de uso.')
    const { motivo, nota } = c.req.valid('json')
    if (motivo === 'breakdown' && (nota ?? '').length < 3) throw rechazo(400, 'Escribe qué le pasa a la máquina.')
    const [abierta] = await c.var.base.select({ id: machineStops.id }).from(machineStops).where(and(eq(machineStops.machineId, m.id), isNull(machineStops.endedAt)))
    if (abierta) throw rechazo(409, 'Esa máquina ya está detenida.')
    await c.var.base.insert(machineStops).values({ id: nuevoId('par'), tenantId: c.var.actor.tenantId, machineId: m.id, reason: motivo, note: nota || null, startedAt: c.var.ahora, startedBy: c.var.actor.id })
    return c.json({ ok: true })
  })

  /** Volver a operar. Si estaba en mantención, la mantención queda hecha hoy. Lo decide el jefe de taller. */
  .post('/maquinas/:id/operar', async (c) => {
    exigirGestion(c)
    const m = await maquinaDe(c)
    const { actor, ahora } = c.var
    await c.var.base.transaction(async (tx) => {
      const [p] = await tx
        .update(machineStops)
        .set({ endedAt: ahora, endedBy: actor.id })
        .where(and(eq(machineStops.machineId, m.id), eq(machineStops.tenantId, actor.tenantId), isNull(machineStops.endedAt)))
        .returning()
      if (!p) throw rechazo(409, 'Esa máquina no está detenida.')
      if (p.reason === 'maintenance') await tx.update(machines).set({ lastMaintenanceAt: diaDe(ahora) }).where(eq(machines.id, m.id))
    })
    return c.json({ ok: true })
  })

  /** Anotar una mantención hecha sin dejar la máquina detenida (un cambio de aceite al cierre del día). */
  .post('/maquinas/:id/mantencion', conDatos(z.object({ nota: z.string().trim().max(300).optional() })), async (c) => {
    exigirGestion(c)
    const m = await maquinaDe(c)
    const { actor, ahora } = c.var
    await c.var.base.transaction(async (tx) => {
      await tx.insert(machineStops).values({ id: nuevoId('par'), tenantId: actor.tenantId, machineId: m.id, reason: 'maintenance', note: c.req.valid('json').nota || null, startedAt: ahora, startedBy: actor.id, endedAt: ahora, endedBy: actor.id })
      await tx.update(machines).set({ lastMaintenanceAt: diaDe(ahora) }).where(eq(machines.id, m.id))
    })
    return c.json({ ok: true })
  })
