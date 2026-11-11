// El sistema de cada rectificadora: recepción, órdenes de trabajo, el tablero del taller por sección y la lista de
// trabajos. Todo filtrado por el tenant de quien pide (`c.var.actor.tenantId`); lo nombrado por id pasa por
// `filaDelTenant`. Cada pedido suma una llamada a la API en el uso del cliente.
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { conDatos, conFiltros, rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { type EntornoTenant, filaDelTenant, soloPersonaDelTenant } from '../acceso/guardias'
import { rutasComercial } from '../comercial/rutas'
import { quotes, customers } from '../comercial/tablas'
import { origenDe, registrar } from '../eventos/registrar'
import { diaDe } from '../plataforma/panorama'
import { users } from '../usuarios/tablas'
import { exigirCupoDeOt, exigirGestion, gestiona, recalcularOt, siguienteNumero, sumarUso, veMontos } from './comun'
import { avanceDeOt, ESTADOS_OT, type EstadoOt, OT_ABIERTAS, PIEZAS, plazoDeOt, PRIORIDADES_OT } from './reglas'
import { services, shopSections, workOrders, workOrderTasks } from './tablas'

const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]

/** Cada pedido al sistema cuenta como una llamada a la API del cliente. */
const contarUso: MiddlewareHandler<EntornoTenant> = async (c, next) => {
  await next()
  await sumarUso(c.var.base, c.var.actor.tenantId, c.var.ahora, { apiCalls: 1 }).catch(() => {})
}

const recepcion = z.object({
  clienteId: z.string().min(1, 'Elige el cliente.'),
  motor: z.string().trim().min(2, 'Escribe el motor (marca y modelo).').max(80),
  numeroMotor: z.string().trim().max(60).optional(),
  equipo: z.string().trim().max(120).optional(),
  piezas: z.array(z.enum(claves(PIEZAS))).min(1, 'Marca qué piezas llegaron.'),
  falla: z.string().trim().max(1000).optional(),
  entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  prioridad: z.enum(claves(PRIORIDADES_OT)).default('normal'),
  /** Agregar el desarme, lavado y medición: lo normal cuando hay que diagnosticar antes de cotizar. */
  diagnostico: z.boolean().default(true),
})

/** Los nombres de las personas del cliente, para mostrar quién tiene cada tarea. */
async function nombresDe(c: { var: EntornoTenant['Variables'] }) {
  const lista = await c.var.base.select({ id: users.id, nombre: users.name }).from(users).where(eq(users.tenantId, c.var.actor.tenantId))
  return new Map(lista.map((u) => [u.id, u.nombre]))
}

/** Avance y conteo de tareas de varias OT a la vez. */
async function avancesDe(c: { var: EntornoTenant['Variables'] }, ids: string[]) {
  if (!ids.length) return new Map<string, { avance: number; total: number; hechas: number }>()
  const tareas = await c.var.base
    .select({ ot: workOrderTasks.workOrderId, estado: workOrderTasks.status, minutos: workOrderTasks.stdMinutes })
    .from(workOrderTasks)
    .where(and(eq(workOrderTasks.tenantId, c.var.actor.tenantId), inArray(workOrderTasks.workOrderId, ids)))
  const porOt = new Map<string, typeof tareas>()
  for (const t of tareas) porOt.set(t.ot, [...(porOt.get(t.ot) ?? []), t])
  return new Map(ids.map((id) => {
    const lista = porOt.get(id) ?? []
    return [id, { avance: avanceDeOt(lista), total: lista.length, hechas: lista.filter((t) => t.estado === 'done').length }]
  }))
}

export const rutasTaller = new Hono<EntornoTenant>()
  .use(soloPersonaDelTenant as unknown as MiddlewareHandler<EntornoTenant>)
  .use(contarUso)

  .get('/inicio', async (c) => {
    const { base, actor, ahora } = c.var
    const hoy = diaDe(ahora)
    const ots = await base
      .select({ id: workOrders.id, numero: workOrders.number, estado: workOrders.status, entrega: workOrders.dueDate, prioridad: workOrders.priority, motor: workOrders.engine, cliente: customers.name, creada: workOrders.createdAt, entregada: workOrders.deliveredAt })
      .from(workOrders)
      .innerJoin(customers, eq(customers.id, workOrders.customerId))
      .where(and(eq(workOrders.tenantId, actor.tenantId), or(inArray(workOrders.status, OT_ABIERTAS), sql`${workOrders.deliveredAt} >= date_trunc('month', ${ahora.toISOString()}::timestamptz)`)))
    const abiertas = ots.filter((o) => OT_ABIERTAS.includes(o.estado))
    const conPlazo = abiertas.map((o) => ({ ...o, plazo: plazoDeOt(o.entrega, o.estado, hoy) }))
    const cuantas = (...estados: EstadoOt[]) => abiertas.filter((o) => estados.includes(o.estado)).length
    const urgentes = conPlazo
      .filter((o) => o.plazo || o.prioridad === 'urgent' || o.estado === 'ready')
      .sort((a, b) => (a.entrega ?? '9999').localeCompare(b.entrega ?? '9999'))
      .slice(0, 12)
    const avances = await avancesDe(c, urgentes.map((o) => o.id))
    const carga = await base
      .select({
        seccionId: shopSections.id,
        nombre: shopSections.name,
        porHacer: sql<number>`count(${workOrderTasks.id}) filter (where ${workOrderTasks.status} = 'pending')`.mapWith(Number),
        enProceso: sql<number>`count(${workOrderTasks.id}) filter (where ${workOrderTasks.status} = 'in_progress')`.mapWith(Number),
        horas: sql<number>`coalesce(sum(${workOrderTasks.stdMinutes}) filter (where ${workOrderTasks.status} <> 'done'), 0) / 60.0`.mapWith(Number),
      })
      .from(shopSections)
      .leftJoin(workOrderTasks, and(eq(workOrderTasks.sectionId, shopSections.id), inArray(workOrderTasks.workOrderId, abiertas.length ? abiertas.map((o) => o.id) : ['-'])))
      .where(and(eq(shopSections.tenantId, actor.tenantId), eq(shopSections.active, true)))
      .groupBy(shopSections.id, shopSections.name, shopSections.position)
      .orderBy(asc(shopSections.position))
    const misTareas = await base
      .select({ id: workOrderTasks.id, nombre: workOrderTasks.name, estado: workOrderTasks.status, otId: workOrders.id, ot: workOrders.number, motor: workOrders.engine, entrega: workOrders.dueDate, seccion: shopSections.name })
      .from(workOrderTasks)
      .innerJoin(workOrders, eq(workOrders.id, workOrderTasks.workOrderId))
      .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
      .where(and(eq(workOrderTasks.tenantId, actor.tenantId), eq(workOrderTasks.assignedTo, actor.id), ne(workOrderTasks.status, 'done'), inArray(workOrders.status, OT_ABIERTAS)))
      .orderBy(sql`case ${workOrderTasks.status} when 'in_progress' then 0 else 1 end`, asc(workOrders.dueDate))
    let comercial = null
    if (veMontos(actor.rol)) {
      const inicioMes = `${hoy.slice(0, 7)}-01`
      const [r] = await base
        .select({
          enviadasMes: sql<number>`count(*) filter (where ${quotes.sentAt} >= ${inicioMes}::date)`.mapWith(Number),
          cotizadoMes: sql<number>`coalesce(sum(${quotes.total}) filter (where ${quotes.sentAt} >= ${inicioMes}::date), 0)`.mapWith(Number),
          aceptadasMes: sql<number>`count(*) filter (where ${quotes.status} = 'accepted' and ${quotes.decidedAt} >= ${inicioMes}::date)`.mapWith(Number),
          aceptadoMes: sql<number>`coalesce(sum(${quotes.total}) filter (where ${quotes.status} = 'accepted' and ${quotes.decidedAt} >= ${inicioMes}::date), 0)`.mapWith(Number),
          pendientes: sql<number>`count(*) filter (where ${quotes.status} = 'sent')`.mapWith(Number),
          montoPendiente: sql<number>`coalesce(sum(${quotes.total}) filter (where ${quotes.status} = 'sent'), 0)`.mapWith(Number),
          decididas90: sql<number>`count(*) filter (where ${quotes.status} in ('accepted', 'rejected') and ${quotes.decidedAt} >= ${hoy}::date - 90)`.mapWith(Number),
          aceptadas90: sql<number>`count(*) filter (where ${quotes.status} = 'accepted' and ${quotes.decidedAt} >= ${hoy}::date - 90)`.mapWith(Number),
        })
        .from(quotes)
        .where(eq(quotes.tenantId, actor.tenantId))
      comercial = { ...r, tasaAceptacion: r.decididas90 ? r.aceptadas90 / r.decididas90 : null }
    }
    return c.json({
      cifras: {
        recibidas: cuantas('received', 'diagnosis'),
        esperando: cuantas('waiting_approval'),
        enTaller: cuantas('in_progress'),
        calidad: cuantas('quality'),
        listas: cuantas('ready'),
        atrasadas: conPlazo.filter((o) => o.plazo === 'atrasada').length,
        porVencer: conPlazo.filter((o) => o.plazo === 'por_vencer').length,
        entregadasMes: ots.filter((o) => o.entregada).length,
      },
      urgentes: urgentes.map((o) => ({ ...o, creada: o.creada.toISOString(), entregada: undefined, ...avances.get(o.id) })),
      carga,
      misTareas: misTareas.map((t) => ({ ...t })),
      comercial,
    })
  })

  .get(
    '/ot',
    conFiltros(z.object({ estado: z.string().optional(), q: z.string().trim().max(80).optional(), pagina: z.coerce.number().int().min(1).default(1), porPagina: z.coerce.number().int().min(10).max(200).default(50) })),
    async (c) => {
      const { base, actor, ahora } = c.var
      const f = c.req.valid('query')
      const estados = !f.estado || f.estado === 'abiertas' ? OT_ABIERTAS : f.estado === 'todas' ? null : (f.estado.split(',').filter((e) => e in ESTADOS_OT) as EstadoOt[])
      const q = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null
      const numero = f.q && /^\d+$/.test(f.q.replace(/^OT-?/i, '')) ? Number(f.q.replace(/^OT-?/i, '')) : null
      const donde = and(
        eq(workOrders.tenantId, actor.tenantId),
        estados ? inArray(workOrders.status, estados) : undefined,
        q ? or(ilike(customers.name, q), ilike(workOrders.engine, q), ilike(workOrders.engineSerial, q), ilike(workOrders.equipment, q), numero ? eq(workOrders.number, numero) : undefined) : undefined,
      )
      const [{ total }] = await base.select({ total: count() }).from(workOrders).innerJoin(customers, eq(customers.id, workOrders.customerId)).where(donde)
      const filas = await base
        .select({ id: workOrders.id, numero: workOrders.number, cliente: customers.name, motor: workOrders.engine, equipo: workOrders.equipment, piezas: workOrders.pieces, estado: workOrders.status, prioridad: workOrders.priority, entrega: workOrders.dueDate, creada: workOrders.createdAt, entregada: workOrders.deliveredAt })
        .from(workOrders)
        .innerJoin(customers, eq(customers.id, workOrders.customerId))
        .where(donde)
        .orderBy(desc(workOrders.number))
        .limit(f.porPagina)
        .offset((f.pagina - 1) * f.porPagina)
      const avances = await avancesDe(c, filas.map((o) => o.id))
      const hoy = diaDe(ahora)
      return c.json({
        total,
        filas: filas.map((o) => ({ ...o, creada: o.creada.toISOString(), entregada: o.entregada?.toISOString() ?? null, plazo: plazoDeOt(o.entrega, o.estado, hoy), ...avances.get(o.id) })),
      })
    },
  )

  /** Recepción: llega un motor o sus piezas. Nace la OT, con el desarme y la medición si hay que diagnosticar. */
  .post('/ot', conDatos(recepcion), async (c) => {
    exigirGestion(c)
    const { base, actor, ahora } = c.var
    const d = c.req.valid('json')
    await filaDelTenant(c, customers, d.clienteId, 'customer', 'ese cliente')
    await exigirCupoDeOt(base, actor.tenantId, ahora)
    const diagnostico = d.diagnostico
      ? await base
          .select({ id: services.id, nombre: services.name, seccion: services.sectionId, horas: services.stdHours })
          .from(services)
          .innerJoin(shopSections, eq(shopSections.id, services.sectionId))
          .where(and(eq(services.tenantId, actor.tenantId), eq(shopSections.kind, 'diagnosis'), eq(services.active, true), inArray(services.code, ['D-01', 'D-02'])))
          .orderBy(asc(services.code))
      : []
    const id = nuevoId('ot')
    const numero = await base.transaction(async (tx) => {
      const numero = await siguienteNumero(tx, workOrders, actor.tenantId)
      await tx.insert(workOrders).values({
        id,
        tenantId: actor.tenantId,
        number: numero,
        customerId: d.clienteId,
        engine: d.motor,
        engineSerial: d.numeroMotor || null,
        equipment: d.equipo || null,
        pieces: d.piezas,
        complaint: d.falla || null,
        priority: d.prioridad,
        dueDate: d.entrega ?? null,
        status: 'received',
        createdBy: actor.id,
        createdAt: ahora,
      })
      if (diagnostico.length)
        await tx.insert(workOrderTasks).values(
          diagnostico.map((t, i) => ({ id: nuevoId('tar'), tenantId: actor.tenantId, workOrderId: id, sectionId: t.seccion, serviceId: t.id, name: t.nombre, quantity: 1, stdMinutes: Math.round(t.horas * 60), position: i, status: 'pending' as const })),
        )
      await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'work_order.created', targetId: id, targetType: 'work_order', metadata: { numero, motor: d.motor, piezas: d.piezas } })
      await sumarUso(tx, actor.tenantId, ahora, { workOrders: 1, features: { work_orders: 1 } })
      return numero
    })
    return c.json({ id, numero })
  })

  .get('/ot/:id', async (c) => {
    const { base, actor } = c.var
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    const [cliente] = await base.select().from(customers).where(and(eq(customers.id, ot.customerId), eq(customers.tenantId, actor.tenantId)))
    const tareas = await base
      .select({ t: workOrderTasks, seccion: shopSections.name, tipoSeccion: shopSections.kind, posSeccion: shopSections.position })
      .from(workOrderTasks)
      .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
      .where(and(eq(workOrderTasks.workOrderId, ot.id), eq(workOrderTasks.tenantId, actor.tenantId)))
      .orderBy(asc(shopSections.position), asc(workOrderTasks.position))
    const cotizaciones = veMontos(actor.rol)
      ? await base
          .select({ id: quotes.id, numero: quotes.number, estado: quotes.status, total: quotes.total, enviada: quotes.sentAt, decidida: quotes.decidedAt })
          .from(quotes)
          .where(and(eq(quotes.tenantId, actor.tenantId), eq(quotes.workOrderId, ot.id)))
          .orderBy(desc(quotes.number))
      : []
    const nombres = await nombresDe(c)
    const iso = (d: Date | null) => d?.toISOString() ?? null
    // La historia de la OT, de lo que quedó guardado: recepción, cotización, cada trabajo, calidad y entrega.
    const historia = [
      { en: ot.createdAt, que: 'Recepción del motor', quien: nombres.get(ot.createdBy ?? '') ?? null },
      ...cotizaciones.flatMap((q) => [
        q.enviada ? { en: q.enviada, que: `Cotización COT-${q.numero} enviada`, quien: null } : null,
        q.decidida && (q.estado === 'accepted' || q.estado === 'rejected') ? { en: q.decidida, que: `Cotización COT-${q.numero} ${q.estado === 'accepted' ? 'aceptada' : 'rechazada'}`, quien: null } : null,
      ]),
      ...tareas.flatMap(({ t }) => [
        t.startedAt ? { en: t.startedAt, que: `Inició: ${t.name}`, quien: nombres.get(t.assignedTo ?? '') ?? null } : null,
        t.finishedAt ? { en: t.finishedAt, que: `Terminó: ${t.name}`, quien: nombres.get(t.finishedBy ?? '') ?? null } : null,
      ]),
      ot.qcApprovedAt ? { en: ot.qcApprovedAt, que: 'Control de calidad aprobado', quien: nombres.get(ot.qcApprovedBy ?? '') ?? null } : null,
      ot.deliveredAt ? { en: ot.deliveredAt, que: `Entregada a ${ot.deliveredTo ?? '—'}`, quien: null } : null,
      ot.cancelledAt ? { en: ot.cancelledAt, que: `Anulada: ${ot.cancelReason ?? ''}`, quien: null } : null,
    ]
      .filter((h): h is { en: Date; que: string; quien: string | null } => Boolean(h))
      .sort((a, b) => b.en.getTime() - a.en.getTime())
      .map((h) => ({ ...h, en: h.en.toISOString() }))
    return c.json({
      id: ot.id,
      numero: ot.number,
      estado: ot.status,
      plazo: plazoDeOt(ot.dueDate, ot.status, diaDe(c.var.ahora)),
      avance: avanceDeOt(tareas.map(({ t }) => ({ estado: t.status, minutos: t.stdMinutes }))),
      cliente: { id: cliente.id, nombre: cliente.name, contacto: cliente.contact, telefono: cliente.phone },
      motor: ot.engine,
      numeroMotor: ot.engineSerial,
      equipo: ot.equipment,
      piezas: ot.pieces,
      falla: ot.complaint,
      prioridad: ot.priority,
      entrega: ot.dueDate,
      creada: ot.createdAt.toISOString(),
      entregada: iso(ot.deliveredAt),
      entregadaA: ot.deliveredTo,
      anulada: iso(ot.cancelledAt),
      motivoAnulacion: ot.cancelReason,
      tareas: tareas.map(({ t, seccion, tipoSeccion }) => ({
        id: t.id,
        nombre: t.name,
        cantidad: t.quantity,
        seccionId: t.sectionId,
        seccion,
        diagnostico: tipoSeccion === 'diagnosis',
        estado: t.status,
        horas: t.stdMinutes / 60,
        asignadoId: t.assignedTo,
        asignado: t.assignedTo ? (nombres.get(t.assignedTo) ?? null) : null,
        inicio: iso(t.startedAt),
        termino: iso(t.finishedAt),
      })),
      cotizaciones: cotizaciones.map((q) => ({ ...q, enviada: iso(q.enviada), decidida: iso(q.decidida) })),
      historia,
    })
  })

  .post('/ot/:id', conDatos(z.object({ entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), prioridad: z.enum(claves(PRIORIDADES_OT)).optional(), equipo: z.string().trim().max(120).optional(), numeroMotor: z.string().trim().max(60).optional(), falla: z.string().trim().max(1000).optional() })), async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status === 'delivered' || ot.status === 'cancelled') throw rechazo(409, 'La OT ya está cerrada.')
    const d = c.req.valid('json')
    await c.var.base
      .update(workOrders)
      .set({
        ...(d.entrega !== undefined ? { dueDate: d.entrega } : {}),
        ...(d.prioridad ? { priority: d.prioridad } : {}),
        ...(d.equipo !== undefined ? { equipment: d.equipo || null } : {}),
        ...(d.numeroMotor !== undefined ? { engineSerial: d.numeroMotor || null } : {}),
        ...(d.falla !== undefined ? { complaint: d.falla || null } : {}),
      })
      .where(and(eq(workOrders.id, ot.id), eq(workOrders.tenantId, c.var.actor.tenantId)))
    return c.json({ ok: true })
  })

  /** Agregar un trabajo de la lista a una OT abierta (una garantía, algo que apareció al armar). */
  .post('/ot/:id/tareas', conDatos(z.object({ trabajoId: z.string(), cantidad: z.number().positive().max(1000).default(1) })), async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status === 'delivered' || ot.status === 'cancelled' || ot.status === 'ready') throw rechazo(409, 'A esta OT ya no se le agregan trabajos.')
    const { trabajoId, cantidad } = c.req.valid('json')
    const trabajo = await filaDelTenant(c, services, trabajoId, 'service', 'ese trabajo')
    await c.var.base.transaction(async (tx) => {
      const [{ ultima }] = await tx.select({ ultima: sql<number>`coalesce(max(${workOrderTasks.position}), -1)`.mapWith(Number) }).from(workOrderTasks).where(eq(workOrderTasks.workOrderId, ot.id))
      await tx.insert(workOrderTasks).values({ id: nuevoId('tar'), tenantId: c.var.actor.tenantId, workOrderId: ot.id, sectionId: trabajo.sectionId, serviceId: trabajo.id, name: cantidad === 1 ? trabajo.name : `${trabajo.name} ×${cantidad}`, quantity: cantidad, stdMinutes: Math.round(trabajo.stdHours * cantidad * 60), position: ultima + 1, status: 'pending' })
      // Un trabajo nuevo en una OT que estaba en calidad la devuelve al taller.
      if (ot.qcApprovedAt) await tx.update(workOrders).set({ qcApprovedAt: null, qcApprovedBy: null }).where(eq(workOrders.id, ot.id))
      await recalcularOt(tx, ot.id)
    })
    return c.json({ ok: true })
  })

  .post('/ot/:id/calidad', async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status !== 'quality') throw rechazo(409, 'Primero se terminan todos los trabajos del taller.')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrders).set({ qcApprovedAt: c.var.ahora, qcApprovedBy: c.var.actor.id }).where(eq(workOrders.id, ot.id))
      await recalcularOt(tx, ot.id)
    })
    return c.json({ ok: true })
  })

  .post('/ot/:id/entregar', conDatos(z.object({ recibe: z.string().trim().min(2, 'Escribe quién recibe.').max(120) })), async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status !== 'ready') throw rechazo(409, 'Solo se entrega una OT lista (con su control de calidad aprobado).')
    const { recibe } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrders).set({ deliveredAt: c.var.ahora, deliveredTo: recibe }).where(eq(workOrders.id, ot.id))
      await recalcularOt(tx, ot.id)
      await registrar(tx, origenDe(c), { tenantId: c.var.actor.tenantId, eventType: 'work_order.closed', targetId: ot.id, targetType: 'work_order', metadata: { numero: ot.number, recibe } })
      await sumarUso(tx, c.var.actor.tenantId, c.var.ahora, { documents: 1 })
    })
    return c.json({ ok: true })
  })

  .post('/ot/:id/anular', conDatos(z.object({ motivo: z.string().trim().min(5, 'Escribe el motivo.').max(500) })), async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status === 'delivered' || ot.status === 'cancelled') throw rechazo(409, 'La OT ya está cerrada.')
    const { motivo } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrders).set({ cancelledAt: c.var.ahora, cancelReason: motivo }).where(eq(workOrders.id, ot.id))
      await recalcularOt(tx, ot.id)
      await registrar(tx, origenDe(c), { tenantId: c.var.actor.tenantId, eventType: 'work_order.cancelled', targetId: ot.id, targetType: 'work_order', metadata: { numero: ot.number, motivo } })
    })
    return c.json({ ok: true })
  })

  /** Iniciar un trabajo. Quien lo inicia lo toma, si no tenía a nadie. Solo lectura no trabaja. */
  .post('/tareas/:id/iniciar', async (c) => {
    const { actor, ahora } = c.var
    if (actor.rol === 'viewer') throw rechazo(403, 'Tu rol es de solo lectura.')
    if (actor.estadoTenant === 'suspended') throw rechazo(403, 'Tu organización está suspendida.')
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    if (t.status !== 'pending') throw rechazo(409, 'Ese trabajo ya se inició.')
    if (t.assignedTo && t.assignedTo !== actor.id && !gestiona(actor.rol)) throw rechazo(403, 'Ese trabajo lo tiene otra persona.')
    const [ot] = await c.var.base.select({ estado: workOrders.status }).from(workOrders).where(eq(workOrders.id, t.workOrderId))
    if (!OT_ABIERTAS.includes(ot.estado) || ot.estado === 'ready') throw rechazo(409, 'La OT ya está cerrada.')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrderTasks).set({ status: 'in_progress', startedAt: ahora, assignedTo: t.assignedTo ?? actor.id }).where(eq(workOrderTasks.id, t.id))
      await recalcularOt(tx, t.workOrderId)
    })
    return c.json({ ok: true })
  })

  .post('/tareas/:id/terminar', async (c) => {
    const { actor, ahora } = c.var
    if (actor.rol === 'viewer') throw rechazo(403, 'Tu rol es de solo lectura.')
    if (actor.estadoTenant === 'suspended') throw rechazo(403, 'Tu organización está suspendida.')
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    if (t.status === 'done') throw rechazo(409, 'Ese trabajo ya está terminado.')
    if (t.assignedTo && t.assignedTo !== actor.id && !gestiona(actor.rol)) throw rechazo(403, 'Lo termina quien lo tiene, o el jefe de taller.')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrderTasks).set({ status: 'done', startedAt: t.startedAt ?? ahora, finishedAt: ahora, finishedBy: actor.id, assignedTo: t.assignedTo ?? actor.id }).where(eq(workOrderTasks.id, t.id))
      await recalcularOt(tx, t.workOrderId)
    })
    return c.json({ ok: true })
  })

  .post('/tareas/:id/asignar', conDatos(z.object({ usuario: z.string().nullable() })), async (c) => {
    exigirGestion(c)
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    if (t.status === 'done') throw rechazo(409, 'Ese trabajo ya está terminado.')
    const { usuario } = c.req.valid('json')
    if (usuario) {
      const u = await filaDelTenant(c, users, usuario, 'user', 'esa persona')
      if (u.status !== 'active' || u.role === 'viewer') throw rechazo(409, 'Esa persona no puede tomar trabajos.')
    }
    await c.var.base.update(workOrderTasks).set({ assignedTo: usuario }).where(eq(workOrderTasks.id, t.id))
    return c.json({ ok: true })
  })

  /**
   * El tablero del taller: por sección, lo que falta hacer de las OT abiertas. Primero lo que está en proceso, después
   * lo urgente y lo que vence antes.
   */
  .get('/taller', conFiltros(z.object({ mias: z.literal('1').optional() })), async (c) => {
    const { base, actor, ahora } = c.var
    const { mias } = c.req.valid('query')
    const secciones = await base.select().from(shopSections).where(and(eq(shopSections.tenantId, actor.tenantId), eq(shopSections.active, true))).orderBy(asc(shopSections.position))
    const tareas = await base
      .select({ t: workOrderTasks, ot: { id: workOrders.id, numero: workOrders.number, motor: workOrders.engine, entrega: workOrders.dueDate, prioridad: workOrders.priority, estado: workOrders.status }, cliente: customers.name })
      .from(workOrderTasks)
      .innerJoin(workOrders, eq(workOrders.id, workOrderTasks.workOrderId))
      .innerJoin(customers, eq(customers.id, workOrders.customerId))
      .where(and(eq(workOrderTasks.tenantId, actor.tenantId), ne(workOrderTasks.status, 'done'), inArray(workOrders.status, ['received', 'diagnosis', 'waiting_approval', 'in_progress']), mias ? eq(workOrderTasks.assignedTo, actor.id) : undefined))
      .orderBy(sql`case ${workOrderTasks.status} when 'in_progress' then 0 else 1 end`, sql`case ${workOrders.priority} when 'urgent' then 0 else 1 end`, sql`${workOrders.dueDate} asc nulls last`, asc(workOrders.number), asc(workOrderTasks.position))
    const nombres = await nombresDe(c)
    const hoy = diaDe(ahora)
    return c.json({
      secciones: secciones.map((s) => ({
        id: s.id,
        nombre: s.name,
        tareas: tareas
          .filter(({ t }) => t.sectionId === s.id)
          .map(({ t, ot, cliente }) => ({
            id: t.id,
            nombre: t.name,
            estado: t.status,
            horas: t.stdMinutes / 60,
            asignadoId: t.assignedTo,
            asignado: t.assignedTo ? (nombres.get(t.assignedTo) ?? null) : null,
            inicio: t.startedAt?.toISOString() ?? null,
            ot: { ...ot, plazo: plazoDeOt(ot.entrega, ot.estado, hoy) },
            cliente,
          })),
      })),
    })
  })

  /** Las personas que pueden tomar trabajos (para asignar). */
  .get('/personas', async (c) => {
    const lista = await c.var.base
      .select({ id: users.id, nombre: users.name, rol: users.role })
      .from(users)
      .where(and(eq(users.tenantId, c.var.actor.tenantId), eq(users.status, 'active'), ne(users.role, 'viewer')))
      .orderBy(asc(users.name))
    return c.json(lista)
  })

  .get('/catalogo', async (c) => {
    const { base, actor } = c.var
    const secciones = await base.select().from(shopSections).where(eq(shopSections.tenantId, actor.tenantId)).orderBy(asc(shopSections.position))
    const trabajos = await base.select().from(services).where(eq(services.tenantId, actor.tenantId)).orderBy(asc(services.code))
    const montos = veMontos(actor.rol)
    return c.json({
      secciones: secciones.map((s) => ({ id: s.id, nombre: s.name, diagnostico: s.kind === 'diagnosis', activa: s.active })),
      trabajos: trabajos.map((t) => ({ id: t.id, seccionId: t.sectionId, codigo: t.code, nombre: t.name, unidad: t.unit, precio: montos ? t.price : null, horas: t.stdHours, activo: t.active })),
    })
  })

  /** Ajustar un trabajo de la lista: precio, horas estándar o si se sigue ofreciendo. Solo el administrador. */
  .post('/catalogo/:id', conDatos(z.object({ precio: z.number().int().min(0).max(1_000_000_000).nullable().optional(), horas: z.number().min(0).max(1000).optional(), activo: z.boolean().optional() })), async (c) => {
    if (c.var.actor.rol !== 'admin') throw rechazo(403, 'Los precios los cambia el administrador.')
    const t = await filaDelTenant(c, services, c.req.param('id'), 'service', 'ese trabajo')
    const d = c.req.valid('json')
    await c.var.base
      .update(services)
      .set({ ...(d.precio !== undefined ? { price: d.precio } : {}), ...(d.horas !== undefined ? { stdHours: d.horas } : {}), ...(d.activo !== undefined ? { active: d.activo } : {}) })
      .where(and(eq(services.id, t.id), eq(services.tenantId, c.var.actor.tenantId)))
    return c.json({ ok: true })
  })

  .route('/', rutasComercial)
