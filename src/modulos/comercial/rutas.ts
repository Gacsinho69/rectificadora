// Clientes y cotizaciones de cada rectificadora. Se montan dentro de `rutasTaller`, detrás de su guardia (solo
// personas del cliente, con su tenant de la sesión). El técnico no ve cotizaciones ni montos.
import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import type { Base } from '../../base'
import { conDatos, conFiltros, rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { formatoRut } from '../../rut'
import { type EntornoTenant, filaDelTenant, filasDelTenant } from '../acceso/guardias'
import { claveDeProveedor, trabajoQueLoNecesita } from '../compras/reglas'
import { suppliers, workOrderParts } from '../compras/tablas'
import { origenDe, registrar } from '../eventos/registrar'
import { exigirCupoDeOt, exigirGestion, exigirMontos, recalcularOt, siguienteNumero, sumarUso } from '../taller/comun'
import { exigirPiezas } from '../taller/piezas'
import { repartirOt } from '../taller/reparto'
import { nombreDeTarea, OT_ABIERTAS } from '../taller/reglas'
import { services, shopSections, workOrders, workOrderTasks } from '../taller/tablas'
import { clienteSchema, cotizacionSchema, type DatosCotizacion, ESTADOS_COTIZACION, type EstadoCotizacion, faltasParaEnviar, totales } from './reglas'
import { customers, quotes } from './tablas'

type C = Context<EntornoTenant>

/** Lo que llega de la pantalla se revisa contra el tenant: el cliente, la OT, las actividades y las secciones deben ser suyos. */
/** `antes`: la OT a la que ya estaba ligado el borrador, que pudo cerrarse después; corregir el borrador no la rechaza. */
async function revisar(c: C, d: DatosCotizacion, antes: string | null = null) {
  await filaDelTenant(c, customers, d.clienteId, 'customer', 'ese cliente')
  if (d.otId) {
    const ot = await filaDelTenant(c, workOrders, d.otId, 'work_order', 'esa orden de trabajo')
    if (ot.customerId !== d.clienteId) throw rechazo(409, 'Esa OT es de otro cliente: elige una OT de este cliente.')
    if (d.otId !== antes) exigirOtAbierta(ot)
  }
  await filasDelTenant(c, services, d.lineas.map((l) => l.trabajoId).filter((t): t is string => Boolean(t)), 'service', 'esa actividad')
  await exigirPiezas(c, d.lineas.map((l) => l.pieza).filter((p): p is string => Boolean(p)), false)
  const secciones = [...new Set(d.lineas.map((l) => l.seccionId).filter((s): s is string => Boolean(s)))]
  if (secciones.length) {
    const propias = await c.var.base.select({ id: shopSections.id }).from(shopSections).where(and(eq(shopSections.tenantId, c.var.actor.tenantId), inArray(shopSections.id, secciones)))
    if (propias.length !== secciones.length) throw rechazo(400, 'Una línea apunta a una sección que no existe.')
  }
  // El proveedor de cada repuesto sale de la lista de la rectificadora; su nombre se guarda como está en la lista.
  const proveedores = await filasDelTenant(c, suppliers, d.lineas.map((l) => l.proveedorId).filter((p): p is string => Boolean(p)), 'supplier', 'ese proveedor')
  const nombre = new Map(proveedores.map((p) => [p.id, p.name]))
  const lineas = d.lineas.map((l) => (l.proveedorId ? { ...l, proveedor: nombre.get(l.proveedorId) ?? null } : l))
  return { ...totales(d.lineas, d.descuento), lineas }
}

/** Lo cotizado entra a una OT que sigue en el taller: no a una entregada o anulada. */
function exigirOtAbierta(ot: { status: (typeof workOrders.$inferSelect)['status'] }) {
  if (!OT_ABIERTAS.includes(ot.status)) throw rechazo(409, 'Esa OT ya está cerrada: cotiza sin OT o con una abierta.')
}

const motorGuardado = (d: DatosCotizacion) => ({ cylinders: d.cilindros ?? null, valvesPerCylinder: d.valvulasPorCilindro ?? null, heads: d.culatas ?? null })

async function cotizacionDe(c: C) {
  return filaDelTenant(c, quotes, c.req.param('id') ?? '', 'quote', 'esa cotización')
}

/**
 * Al aceptar: las actividades cotizadas pasan a la OT, cada una a su sección y a la ruta de su pieza, y se reparten
 * entre sus especialistas. Si la cotización no venía de una OT, nace una. Lo que la OT ya tiene de su diagnóstico (el
 * desarme, la medición) no se repite: se cobra, pero ya se hizo o se está haciendo.
 */
async function pasarAlTaller(tx: Base, c: C, q: typeof quotes.$inferSelect) {
  const { actor, ahora } = c.var
  const motor = { cylinders: q.cylinders, valvesPerCylinder: q.valvesPerCylinder, heads: q.heads }
  let otId = q.workOrderId
  if (!otId) {
    otId = nuevoId('ot')
    const numero = await siguienteNumero(tx, workOrders, actor.tenantId)
    await exigirCupoDeOt(tx, actor.tenantId, ahora)
    await tx.insert(workOrders).values({ id: otId, tenantId: actor.tenantId, number: numero, customerId: q.customerId, quoteId: q.id, engine: q.engine, ...motor, pieces: ['motor'], status: 'received', createdBy: actor.id, createdAt: ahora })
    await tx.update(quotes).set({ workOrderId: otId }).where(eq(quotes.id, q.id))
    await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'work_order.created', targetId: otId, targetType: 'work_order', metadata: { numero, desde: `COT-${q.number}` } })
    await sumarUso(tx, actor.tenantId, ahora, { workOrders: 1, features: { work_orders: 1 } })
  } else {
    const [ot] = await tx.select({ status: workOrders.status }).from(workOrders).where(eq(workOrders.id, otId))
    exigirOtAbierta(ot)
    // Lo que dice la cotización aceptada del motor (después del diagnóstico) queda en la OT, si se sabía.
    const sabido = Object.fromEntries(Object.entries(motor).filter(([, v]) => v !== null))
    await tx.update(workOrders).set({ quoteId: q.id, ...sabido }).where(eq(workOrders.id, otId))
  }
  const [primera] = await tx.select({ id: shopSections.id }).from(shopSections).where(and(eq(shopSections.tenantId, actor.tenantId), eq(shopSections.kind, 'work'))).orderBy(asc(shopSections.position)).limit(1)
  const yaEnDiagnostico = new Set(
    (
      await tx
        .select({ servicio: workOrderTasks.serviceId })
        .from(workOrderTasks)
        .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
        .where(and(eq(workOrderTasks.workOrderId, otId), eq(shopSections.kind, 'diagnosis')))
    ).map((t) => t.servicio),
  )
  const trabajos = q.lines.filter((l) => l.tipo === 'trabajo' && !(l.trabajoId && yaEnDiagnostico.has(l.trabajoId)))
  const ids = trabajos.map((l) => l.trabajoId).filter((t): t is string => Boolean(t))
  const actividades = new Map((ids.length ? await tx.select().from(services).where(and(eq(services.tenantId, actor.tenantId), inArray(services.id, ids))) : []).map((a) => [a.id, a]))
  const [{ ultima }] = await tx.select({ ultima: sql<number>`coalesce(max(${workOrderTasks.position}), -1)`.mapWith(Number) }).from(workOrderTasks).where(eq(workOrderTasks.workOrderId, otId))
  if (trabajos.length)
    await tx.insert(workOrderTasks).values(
      trabajos.map((l, i) => {
        const a = l.trabajoId ? actividades.get(l.trabajoId) : undefined
        return {
          id: nuevoId('tar'),
          tenantId: actor.tenantId,
          workOrderId: otId!,
          sectionId: l.seccionId ?? a?.sectionId ?? primera.id,
          serviceId: l.trabajoId,
          name: nombreDeTarea(l.descripcion, l.cantidad, l.criterio ?? a?.criterion),
          quantity: l.cantidad,
          stdMinutes: Math.round(l.horas * l.cantidad * 60),
          position: ultima + 1 + i,
          piece: l.pieza ?? a?.piece ?? 'motor',
          step: a?.step ?? 100,
          status: 'pending' as const,
        }
      }),
    )
  await repartirOt(tx, actor.tenantId, otId)
  // Los repuestos cotizados quedan en la OT: por pedir (los compra la rectificadora) o por llegar (los trae el cliente),
  // cada uno esperado por el trabajo que lo necesita: el que dice la línea, o el armado.
  const repuestos = q.lines.filter((l) => l.tipo === 'repuesto')
  if (repuestos.length) {
    const tareas = await tx
      .select({ id: workOrderTasks.id, codigo: services.code, pieza: workOrderTasks.piece, paso: workOrderTasks.step, estado: workOrderTasks.status, tipo: shopSections.kind })
      .from(workOrderTasks)
      .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
      .leftJoin(services, eq(services.id, workOrderTasks.serviceId))
      .where(eq(workOrderTasks.workOrderId, otId))
    const enLaOt = tareas.map((t) => ({ ...t, diagnostico: t.tipo === 'diagnosis' }))
    const [{ ultimo }] = await tx.select({ ultimo: sql<number>`coalesce(max(${workOrderParts.position}), -1)`.mapWith(Number) }).from(workOrderParts).where(eq(workOrderParts.workOrderId, otId))
    // El proveedor cotizado: el de la lista; una cotización anterior a la lista lo trae solo por su nombre, y vale si
    // está en la lista con el mismo nombre (sin contar mayúsculas, tildes ni espacios).
    const lista = await tx.select({ id: suppliers.id, nombre: suppliers.name, clave: suppliers.nameKey }).from(suppliers).where(eq(suppliers.tenantId, actor.tenantId))
    const proveedorDe = (l: (typeof repuestos)[number]) => (l.compra === 'customer' ? undefined : (lista.find((p) => p.id === l.proveedorId) ?? (l.proveedor ? lista.find((p) => p.clave === claveDeProveedor(l.proveedor!)) : undefined)))
    await tx.insert(workOrderParts).values(
      repuestos.map((l, i) => ({
        id: nuevoId('rep'),
        tenantId: actor.tenantId,
        workOrderId: otId!,
        quoteId: q.id,
        description: l.descripcion,
        quantity: l.cantidad,
        position: ultimo + 1 + i,
        source: l.compra ?? ('shop' as const),
        size: l.medida || null,
        brand: l.marca || null,
        partNumber: l.numeroParte || null,
        supplierId: proveedorDe(l)?.id ?? null,
        supplier: proveedorDe(l)?.nombre ?? (l.compra === 'customer' ? null : l.proveedor || null),
        unitCost: l.costo ?? null,
        unitPrice: l.compra === 'customer' ? null : (l.precio ?? null),
        neededByTaskId: trabajoQueLoNecesita(enLaOt, l.necesita)?.id ?? null,
        status: 'pending' as const,
        createdBy: actor.id,
        createdAt: ahora,
      })),
    )
  }
  await recalcularOt(tx, otId)
  return otId
}

export const rutasComercial = new Hono<EntornoTenant>()
  .get('/clientes', conFiltros(z.object({ q: z.string().trim().max(80).optional() })), async (c) => {
    const { base, actor } = c.var
    const { q } = c.req.valid('query')
    const patron = q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null
    // El RUT va guardado con puntos y guion: «12345678» también encuentra «12.345.678-5».
    const soloRut = q?.replace(/[^0-9kK]/g, '') ?? ''
    // En las subconsultas el cliente va con el nombre de su tabla: Drizzle escribe las columnas de una consulta a una
    // sola tabla sin él, y «id» a secas sería el de la OT.
    const lista = await base
      .select({
        id: customers.id,
        nombre: customers.name,
        rut: customers.taxId,
        contacto: customers.contact,
        telefono: customers.phone,
        correo: customers.email,
        abiertas: sql<number>`(select count(*) from work_orders w where w.customer_id = "customers"."id" and w.tenant_id = ${actor.tenantId} and w.status in ('received','diagnosis','waiting_approval','in_progress','quality','ready'))`.mapWith(Number),
        total: sql<number>`(select count(*) from work_orders w where w.customer_id = "customers"."id" and w.tenant_id = ${actor.tenantId})`.mapWith(Number),
        ultima: sql<string | null>`(select max(w.created_at) from work_orders w where w.customer_id = "customers"."id" and w.tenant_id = ${actor.tenantId})`,
      })
      .from(customers)
      .where(and(eq(customers.tenantId, actor.tenantId), patron ? or(ilike(customers.name, patron), ilike(customers.taxId, patron), soloRut.length >= 3 ? sql`regexp_replace(${customers.taxId}, '[^0-9kK]', '', 'g') ilike ${`%${soloRut}%`}` : undefined, ilike(customers.contact, patron)) : undefined))
      .orderBy(asc(customers.name))
    return c.json(lista.map((x) => ({ ...x, ultima: x.ultima ? new Date(x.ultima).toISOString() : null })))
  })

  .post('/clientes', conDatos(clienteSchema), async (c) => {
    exigirGestion(c)
    const d = c.req.valid('json')
    const id = nuevoId('cl')
    await c.var.base.insert(customers).values({ id, tenantId: c.var.actor.tenantId, name: d.nombre, taxId: d.rut ? formatoRut(d.rut) : null, contact: d.contacto || null, phone: d.telefono || null, email: d.correo || null, createdAt: c.var.ahora })
    return c.json({ id })
  })

  .get(
    '/cotizaciones',
    conFiltros(z.object({ estado: z.string().optional(), q: z.string().trim().max(80).optional(), pagina: z.coerce.number().int().min(1).default(1), porPagina: z.coerce.number().int().min(10).max(200).default(50) })),
    async (c) => {
      exigirMontos(c)
      const { base, actor } = c.var
      const f = c.req.valid('query')
      const estados = f.estado ? (f.estado.split(',').filter((e) => e in ESTADOS_COTIZACION) as EstadoCotizacion[]) : null
      if (estados && !estados.length) throw rechazo(400, 'Ese estado de cotización no existe.')
      const patron = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null
      const numero = f.q && /^\d+$/.test(f.q.replace(/^COT-?/i, '')) ? Number(f.q.replace(/^COT-?/i, '')) : null
      const donde = and(
        eq(quotes.tenantId, actor.tenantId),
        estados?.length ? inArray(quotes.status, estados) : undefined,
        patron ? or(ilike(customers.name, patron), ilike(quotes.engine, patron), numero ? eq(quotes.number, numero) : undefined) : undefined,
      )
      const [{ total }] = await base.select({ total: count() }).from(quotes).innerJoin(customers, eq(customers.id, quotes.customerId)).where(donde)
      const filas = await base
        .select({ id: quotes.id, numero: quotes.number, cliente: customers.name, motor: quotes.engine, estado: quotes.status, total: quotes.total, creada: quotes.createdAt, enviada: quotes.sentAt, decidida: quotes.decidedAt, otId: quotes.workOrderId, ot: workOrders.number })
        .from(quotes)
        .innerJoin(customers, eq(customers.id, quotes.customerId))
        .leftJoin(workOrders, eq(workOrders.id, quotes.workOrderId))
        .where(donde)
        .orderBy(desc(quotes.number))
        .limit(f.porPagina)
        .offset((f.pagina - 1) * f.porPagina)
      const iso = (d: Date | null) => d?.toISOString() ?? null
      return c.json({ total, filas: filas.map((q) => ({ ...q, creada: q.creada.toISOString(), enviada: iso(q.enviada), decidida: iso(q.decidida) })) })
    },
  )

  .get('/cotizaciones/:id', async (c) => {
    exigirMontos(c)
    const q = await cotizacionDe(c)
    const [cliente] = await c.var.base.select().from(customers).where(and(eq(customers.id, q.customerId), eq(customers.tenantId, c.var.actor.tenantId)))
    const [ot] = q.workOrderId ? await c.var.base.select({ numero: workOrders.number, estado: workOrders.status }).from(workOrders).where(eq(workOrders.id, q.workOrderId)) : []
    const iso = (d: Date | null) => d?.toISOString() ?? null
    return c.json({
      id: q.id,
      numero: q.number,
      estado: q.status,
      cliente: { id: cliente.id, nombre: cliente.name, rut: cliente.taxId, contacto: cliente.contact },
      otId: q.workOrderId,
      ot: ot ? { numero: ot.numero, estado: ot.estado } : null,
      motor: q.engine,
      cilindros: q.cylinders,
      valvulasPorCilindro: q.valvesPerCylinder,
      culatas: q.heads,
      lineas: q.lines,
      descuento: q.discountPct,
      notas: q.notes,
      ...totales(q.lines, q.discountPct),
      creada: q.createdAt.toISOString(),
      enviada: iso(q.sentAt),
      decidida: iso(q.decidedAt),
      nota: q.decisionNote,
    })
  })

  /** Una cotización nueva nace en borrador. Puede venir de una OT (después del diagnóstico) o ir sola. */
  .post('/cotizaciones', conDatos(cotizacionSchema), async (c) => {
    exigirGestion(c)
    const d = c.req.valid('json')
    const t = await revisar(c, d)
    const { actor, ahora } = c.var
    const id = nuevoId('cot')
    const numero = await c.var.base.transaction(async (tx) => {
      const numero = await siguienteNumero(tx, quotes, actor.tenantId)
      await tx.insert(quotes).values({ id, tenantId: actor.tenantId, number: numero, customerId: d.clienteId, workOrderId: d.otId ?? null, engine: d.motor, ...motorGuardado(d), lines: t.lineas, discountPct: d.descuento, net: t.neto, tax: t.iva, total: t.total, notes: d.notas || null, status: 'draft', createdBy: actor.id, createdAt: ahora })
      await sumarUso(tx, actor.tenantId, ahora, { quotes: 1, features: { quotes: 1 } })
      return numero
    })
    return c.json({ id, numero })
  })

  .post('/cotizaciones/:id', conDatos(cotizacionSchema), async (c) => {
    exigirGestion(c)
    const q = await cotizacionDe(c)
    if (q.status !== 'draft') throw rechazo(409, 'Una cotización enviada no se edita: anúlala y haz otra.')
    const d = c.req.valid('json')
    const t = await revisar(c, d, q.workOrderId)
    // Solo si sigue en borrador: si otro la envió entretanto, lo que recibió el cliente no cambia.
    const [editada] = await c.var.base
      .update(quotes)
      .set({ customerId: d.clienteId, workOrderId: d.otId ?? null, engine: d.motor, ...motorGuardado(d), lines: t.lineas, discountPct: d.descuento, net: t.neto, tax: t.iva, total: t.total, notes: d.notas || null })
      .where(and(eq(quotes.id, q.id), eq(quotes.tenantId, c.var.actor.tenantId), eq(quotes.status, 'draft')))
      .returning({ id: quotes.id })
    if (!editada) throw rechazo(409, 'Esa cotización ya se envió o se anuló: no se edita.')
    return c.json({ ok: true })
  })

  .post('/cotizaciones/:id/enviar', async (c) => {
    exigirGestion(c)
    const q = await cotizacionDe(c)
    if (q.status !== 'draft') throw rechazo(409, 'Solo se envía un borrador.')
    const faltas = faltasParaEnviar(q.lines)
    if (faltas.length) throw rechazo(409, faltas.join(' '))
    // Su OT se pudo cerrar mientras era borrador: enviada así, no se podría aceptar.
    if (q.workOrderId) {
      const [ot] = await c.var.base.select({ status: workOrders.status }).from(workOrders).where(eq(workOrders.id, q.workOrderId))
      if (!OT_ABIERTAS.includes(ot.status)) throw rechazo(409, 'La OT de esta cotización ya se cerró: quítala (o elige una abierta) y vuelve a enviarla.')
    }
    const { actor, ahora } = c.var
    await c.var.base.transaction(async (tx) => {
      const [enviada] = await tx.update(quotes).set({ status: 'sent', sentAt: ahora }).where(and(eq(quotes.id, q.id), eq(quotes.status, 'draft'))).returning({ id: quotes.id })
      if (!enviada) throw rechazo(409, 'Esa cotización ya se envió.')
      if (q.workOrderId) {
        await tx.update(workOrders).set({ quoteId: q.id }).where(eq(workOrders.id, q.workOrderId))
        await recalcularOt(tx, q.workOrderId)
      }
      await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'quote.sent', targetId: q.id, targetType: 'quote', metadata: { numero: q.number, total: q.total } })
      await sumarUso(tx, actor.tenantId, ahora, { documents: 1 })
    })
    return c.json({ ok: true })
  })

  .post('/cotizaciones/:id/aceptar', conDatos(z.object({ nota: z.string().trim().max(500).optional() })), async (c) => {
    exigirGestion(c)
    const q = await cotizacionDe(c)
    if (q.status !== 'sent') throw rechazo(409, 'Solo se acepta una cotización enviada.')
    const { nota } = c.req.valid('json')
    const otId = await c.var.base.transaction(async (tx) => {
      // Solo si sigue enviada: dos que aceptan a la vez (un doble clic) no crean dos OT.
      const [aceptada] = await tx.update(quotes).set({ status: 'accepted', decidedAt: c.var.ahora, decisionNote: nota || null }).where(and(eq(quotes.id, q.id), eq(quotes.status, 'sent'))).returning({ id: quotes.id })
      if (!aceptada) throw rechazo(409, 'Esa cotización ya se decidió.')
      const otId = await pasarAlTaller(tx, c, { ...q, status: 'accepted' })
      await registrar(tx, origenDe(c), { tenantId: c.var.actor.tenantId, eventType: 'quote.accepted', targetId: q.id, targetType: 'quote', metadata: { numero: q.number, total: q.total, ot: otId } })
      return otId
    })
    return c.json({ ok: true, otId })
  })

  .post('/cotizaciones/:id/rechazar', conDatos(z.object({ nota: z.string().trim().min(3, 'Escribe por qué la rechazó.').max(500) })), async (c) => {
    exigirGestion(c)
    const q = await cotizacionDe(c)
    if (q.status !== 'sent') throw rechazo(409, 'Solo se rechaza una cotización enviada.')
    const { nota } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      // Solo si sigue enviada: si otro la aceptó entretanto, no se pisa la aceptación (ni su OT).
      const [rechazada] = await tx.update(quotes).set({ status: 'rejected', decidedAt: c.var.ahora, decisionNote: nota }).where(and(eq(quotes.id, q.id), eq(quotes.status, 'sent'))).returning({ id: quotes.id })
      if (!rechazada) throw rechazo(409, 'Esa cotización ya se decidió.')
      if (q.workOrderId) await recalcularOt(tx, q.workOrderId)
      await registrar(tx, origenDe(c), { tenantId: c.var.actor.tenantId, eventType: 'quote.rejected', targetId: q.id, targetType: 'quote', metadata: { numero: q.number, motivo: nota } })
    })
    return c.json({ ok: true })
  })

  .post('/cotizaciones/:id/anular', conDatos(z.object({ nota: z.string().trim().min(3, 'Escribe el motivo.').max(500) })), async (c) => {
    exigirGestion(c)
    const q = await cotizacionDe(c)
    if (q.status !== 'draft' && q.status !== 'sent') throw rechazo(409, 'Solo se anula un borrador o una enviada.')
    const { nota } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      const [anulada] = await tx.update(quotes).set({ status: 'cancelled', decidedAt: c.var.ahora, decisionNote: nota }).where(and(eq(quotes.id, q.id), inArray(quotes.status, ['draft', 'sent']))).returning({ id: quotes.id })
      if (!anulada) throw rechazo(409, 'Esa cotización ya se decidió.')
      if (q.workOrderId) await recalcularOt(tx, q.workOrderId)
      await registrar(tx, origenDe(c), { tenantId: c.var.actor.tenantId, eventType: 'quote.cancelled', targetId: q.id, targetType: 'quote', metadata: { numero: q.number, estado_anterior: q.status, motivo: nota } })
    })
    return c.json({ ok: true })
  })

  /** Las OT abiertas de un cliente, para cotizar desde el diagnóstico. */
  .get('/clientes/:id/ot', async (c) => {
    const cl = await filaDelTenant(c, customers, c.req.param('id'), 'customer', 'ese cliente')
    const lista = await c.var.base
      .select({ id: workOrders.id, numero: workOrders.number, motor: workOrders.engine, estado: workOrders.status, cilindros: workOrders.cylinders, valvulasPorCilindro: workOrders.valvesPerCylinder, culatas: workOrders.heads })
      .from(workOrders)
      .where(and(eq(workOrders.tenantId, c.var.actor.tenantId), eq(workOrders.customerId, cl.id), inArray(workOrders.status, OT_ABIERTAS)))
      .orderBy(desc(workOrders.number))
    return c.json(lista)
  })
