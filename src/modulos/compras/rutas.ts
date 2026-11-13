// Los repuestos y las compras de cada rectificadora: la lista de proveedores, lo que hay que pedir, las órdenes de
// compra a un proveedor con su chofer, la recepción en el taller, lo que traen los clientes y los repuestos que aparecen
// con la OT abierta. Se monta dentro de `rutasTaller`, detrás de su guardia (solo personas del cliente, con su tenant
// de la sesión). El técnico no ve costos ni la lista de proveedores: del proveedor ve solo dónde retirar una orden.
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import { conDatos, rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { formatoRut } from '../../rut'
import { type EntornoTenant, filaDelTenant, filasDelTenant } from '../acceso/guardias'
import { customers } from '../comercial/tablas'
import { origenDe, registrar } from '../eventos/registrar'
import { exigirGestion, gestiona, siguienteNumero, sumarUso, veMontos } from '../taller/comun'
import { OT_EN_TALLER } from '../taller/reparto'
import { services, shopSections, workOrders, workOrderTasks } from '../taller/tablas'
import { users } from '../usuarios/tablas'
import { recalcularOc } from './comun'
import { claveDeProveedor, type DatosProveedor, folioOc, POR_LLEGAR, proveedorSchema, QUIEN_COMPRA, trabajoQueLoNecesita } from './reglas'
import { purchaseOrders, suppliers, workOrderParts } from './tablas'

type C = Context<EntornoTenant>
const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const nuevaOrden = z.object({
  repuestos: z.array(z.string()).min(1, 'Elige qué repuestos pedir.').max(200),
  proveedorId: z.string({ error: 'Elige el proveedor.' }).min(1, 'Elige el proveedor.'),
  choferId: z.string().nullable().optional(),
  llega: fechaSchema.nullable().optional(),
  nota: z.string().trim().max(500).optional(),
})

const nuevoRepuesto = z.object({
  descripcion: z.string().trim().min(2, 'Escribe el repuesto.').max(200),
  cantidad: z.number().positive('La cantidad debe ser mayor que cero.').max(10_000).default(1),
  compra: z.enum(claves(QUIEN_COMPRA)).default('shop'),
  proveedorId: z.string().nullable().optional(),
  costo: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  necesitaTareaId: z.string().nullable().optional(),
})

async function nombresDe(c: C) {
  const lista = await c.var.base.select({ id: users.id, nombre: users.name }).from(users).where(eq(users.tenantId, c.var.actor.tenantId))
  return new Map(lista.map((u) => [u.id, u.nombre]))
}

/** El chofer es alguien del taller que puede tomar trabajos: no alguien bloqueado ni de solo lectura. */
async function exigirChofer(c: C, choferId: string) {
  const u = await filaDelTenant(c, users, choferId, 'user', 'esa persona')
  if (u.status !== 'active' || u.role === 'viewer') throw rechazo(409, 'El chofer tiene que ser alguien activo que pueda tomar trabajos.')
}

/** Recibir: el jefe de taller o el administrador, o el chofer de esa orden. */
function exigirQuienRecibe(c: C, choferId: string | null) {
  const { actor } = c.var
  if (actor.estadoTenant === 'suspended' || actor.estadoTenant === 'cancelled') throw rechazo(403, 'Tu organización está suspendida: puedes revisar, pero no hacer cambios.')
  if (!gestiona(actor.rol) && choferId !== actor.id) throw rechazo(403, 'Lo recibe el chofer de esa orden o el jefe de taller.')
}

/** Un proveedor de la lista de la propia rectificadora. */
const proveedorDe = (c: C, id: string) => filaDelTenant(c, suppliers, id, 'supplier', 'ese proveedor')

/** La lista de proveedores es de quien compra y cotiza: el técnico no la ve. */
function exigirVerProveedores(c: C) {
  if (!veMontos(c.var.actor.rol)) throw rechazo(403, 'Tu rol no ve la lista de proveedores.')
}

/** Lo que se guarda de un proveedor: lo vacío queda sin dato y el RUT, con puntos y guion. */
const datosDeProveedor = (d: DatosProveedor) => ({
  name: d.nombre,
  nameKey: claveDeProveedor(d.nombre),
  taxId: d.rut ? formatoRut(d.rut) : null,
  contact: d.contacto || null,
  phone: d.telefono || null,
  email: d.correo || null,
  address: d.direccion || null,
  notes: d.nota || null,
})

/** El mismo proveedor no va dos veces en la lista, aunque se escriba con otras mayúsculas, tildes o espacios. */
async function exigirNombreLibre(c: C, nombre: string, salvo?: string) {
  const [otro] = await c.var.base
    .select({ nombre: suppliers.name })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, c.var.actor.tenantId), eq(suppliers.nameKey, claveDeProveedor(nombre)), salvo ? ne(suppliers.id, salvo) : undefined))
  if (otro) throw rechazo(409, `Ese proveedor ya está en la lista: ${otro.nombre}.`)
}

export const rutasCompras = new Hono<EntornoTenant>()
  /** Los proveedores de la rectificadora, con sus órdenes de compra: las que están por retirar, cuántas van y la última. */
  .get('/proveedores', async (c) => {
    exigirVerProveedores(c)
    const { base, actor } = c.var
    const lista = await base
      // En las subconsultas el proveedor va con el nombre de su tabla: Drizzle escribe las columnas de una consulta a una
      // sola tabla sin él, y «id» a secas sería el de la orden de compra.
      .select({
        id: suppliers.id,
        nombre: suppliers.name,
        rut: suppliers.taxId,
        contacto: suppliers.contact,
        telefono: suppliers.phone,
        correo: suppliers.email,
        direccion: suppliers.address,
        nota: suppliers.notes,
        activo: suppliers.active,
        porRetirar: sql<number>`(select count(*) from purchase_orders o where o.supplier_id = "suppliers"."id" and o.tenant_id = ${actor.tenantId} and o.status = 'open')`.mapWith(Number),
        ordenes: sql<number>`(select count(*) from purchase_orders o where o.supplier_id = "suppliers"."id" and o.tenant_id = ${actor.tenantId} and o.status <> 'cancelled')`.mapWith(Number),
        ultima: sql<string | null>`(select max(o.created_at) from purchase_orders o where o.supplier_id = "suppliers"."id" and o.tenant_id = ${actor.tenantId} and o.status <> 'cancelled')`,
      })
      .from(suppliers)
      .where(eq(suppliers.tenantId, actor.tenantId))
      .orderBy(desc(suppliers.active), asc(suppliers.name))
    return c.json(lista.map((p) => ({ ...p, ultima: p.ultima ? new Date(p.ultima).toISOString() : null })))
  })

  .post('/proveedores', conDatos(proveedorSchema), async (c) => {
    exigirGestion(c)
    const d = c.req.valid('json')
    await exigirNombreLibre(c, d.nombre)
    const id = nuevoId('prv')
    await c.var.base.insert(suppliers).values({ id, tenantId: c.var.actor.tenantId, ...datosDeProveedor(d), active: d.activo ?? true, createdBy: c.var.actor.id, createdAt: c.var.ahora })
    return c.json({ id, nombre: d.nombre })
  })

  /** Corregir los datos de un proveedor, o desactivarlo: deja de ofrecerse, y sus órdenes quedan como están. */
  .post('/proveedores/:id', conDatos(proveedorSchema), async (c) => {
    exigirGestion(c)
    const p = await proveedorDe(c, c.req.param('id'))
    const d = c.req.valid('json')
    await exigirNombreLibre(c, d.nombre, p.id)
    const { tenantId } = c.var.actor
    await c.var.base.transaction(async (tx) => {
      await tx.update(suppliers).set({ ...datosDeProveedor(d), active: d.activo ?? p.active }).where(and(eq(suppliers.id, p.id), eq(suppliers.tenantId, tenantId)))
      // El nombre va guardado junto a cada orden y cada repuesto: si se corrige en la lista, se corrige en todos.
      if (d.nombre !== p.name) {
        await tx.update(purchaseOrders).set({ supplier: d.nombre }).where(and(eq(purchaseOrders.supplierId, p.id), eq(purchaseOrders.tenantId, tenantId)))
        await tx.update(workOrderParts).set({ supplier: d.nombre }).where(and(eq(workOrderParts.supplierId, p.id), eq(workOrderParts.tenantId, tenantId)))
      }
    })
    return c.json({ ok: true })
  })

  /**
   * Las compras: lo que hay que pedir (lo que compra la rectificadora y todavía no se pide), lo que traen los clientes,
   * y las órdenes de compra por retirar y las últimas cerradas, cada una con sus repuestos.
   */
  .get('/compras', async (c) => {
    const { base, actor } = c.var
    const montos = veMontos(actor.rol)
    const nombres = await nombresDe(c)
    // Dónde se retira cada orden: la dirección y el teléfono de su proveedor, para el chofer.
    const retiro = new Map((await base.select({ id: suppliers.id, direccion: suppliers.address, telefono: suppliers.phone }).from(suppliers).where(eq(suppliers.tenantId, actor.tenantId))).map((p) => [p.id, p]))
    const ordenes = await base.select().from(purchaseOrders).where(eq(purchaseOrders.tenantId, actor.tenantId)).orderBy(desc(purchaseOrders.number))
    const visibles = [...ordenes.filter((o) => o.status === 'open'), ...ordenes.filter((o) => o.status !== 'open').slice(0, 20)]
    const filas = await base
      .select({ r: workOrderParts, ot: { id: workOrders.id, numero: workOrders.number, motor: workOrders.engine }, cliente: customers.name, necesita: workOrderTasks.name })
      .from(workOrderParts)
      .innerJoin(workOrders, eq(workOrders.id, workOrderParts.workOrderId))
      .innerJoin(customers, eq(customers.id, workOrders.customerId))
      .leftJoin(workOrderTasks, eq(workOrderTasks.id, workOrderParts.neededByTaskId))
      .where(
        and(
          eq(workOrderParts.tenantId, actor.tenantId),
          or(and(isNull(workOrderParts.purchaseOrderId), eq(workOrderParts.status, 'pending')), visibles.length ? inArray(workOrderParts.purchaseOrderId, visibles.map((o) => o.id)) : undefined),
        ),
      )
      .orderBy(asc(workOrderParts.createdAt), asc(workOrderParts.position))
    const iso = (d: Date | null) => d?.toISOString() ?? null
    const repuesto = ({ r, ot, cliente, necesita }: (typeof filas)[number]) => ({
      id: r.id,
      descripcion: r.description,
      cantidad: r.quantity,
      compra: r.source,
      proveedorId: montos ? r.supplierId : null,
      proveedor: montos ? r.supplier : null,
      costo: montos ? r.unitCost : null,
      estado: r.status,
      ot,
      cliente,
      necesita,
      ocId: r.purchaseOrderId,
      recibido: iso(r.receivedAt),
      creado: r.createdAt.toISOString(),
    })
    return c.json({
      porPedir: filas.filter(({ r }) => r.source === 'shop' && r.status === 'pending').map(repuesto),
      clientes: filas.filter(({ r }) => r.source === 'customer' && r.status === 'pending').map(repuesto),
      ordenes: visibles.map((o) => {
        const suyos = filas.filter(({ r }) => r.purchaseOrderId === o.id)
        return {
          id: o.id,
          numero: o.number,
          proveedorId: o.supplierId,
          proveedor: o.supplier,
          direccion: (o.supplierId && retiro.get(o.supplierId)?.direccion) || null,
          telefono: (o.supplierId && retiro.get(o.supplierId)?.telefono) || null,
          chofer: o.driverId ? { id: o.driverId, nombre: nombres.get(o.driverId) ?? '—' } : null,
          estado: o.status,
          llega: o.expectedAt,
          nota: o.notes,
          creada: o.createdAt.toISOString(),
          recibida: iso(o.receivedAt),
          anulada: iso(o.cancelledAt),
          motivo: o.cancelReason,
          costo: montos ? suyos.reduce((s, { r }) => s + Math.round((r.unitCost ?? 0) * r.quantity), 0) : null,
          repuestos: suyos.map(repuesto),
        }
      }),
    })
  })

  /** Emitir una orden de compra: los repuestos elegidos quedan pedidos a un proveedor de la lista, con el chofer que va a buscarlos. */
  .post('/compras/ordenes', conDatos(nuevaOrden), async (c) => {
    exigirGestion(c)
    const { actor, ahora } = c.var
    const d = c.req.valid('json')
    const repuestos = await filasDelTenant(c, workOrderParts, d.repuestos, 'part', 'ese repuesto')
    if (repuestos.some((r) => r.source !== 'shop' || r.status !== 'pending')) throw rechazo(409, 'Solo se piden los repuestos que compra la rectificadora y que están por pedir.')
    const proveedor = await proveedorDe(c, d.proveedorId)
    if (!proveedor.active) throw rechazo(409, `${proveedor.name} está inactivo: actívalo en Proveedores o elige otro.`)
    if (d.choferId) await exigirChofer(c, d.choferId)
    const id = nuevoId('oc')
    const numero = await c.var.base.transaction(async (tx) => {
      const numero = await siguienteNumero(tx, purchaseOrders, actor.tenantId)
      await tx.insert(purchaseOrders).values({ id, tenantId: actor.tenantId, number: numero, supplierId: proveedor.id, supplier: proveedor.name, driverId: d.choferId ?? null, expectedAt: d.llega ?? null, notes: d.nota || null, status: 'open', createdBy: actor.id, createdAt: ahora })
      await tx.update(workOrderParts).set({ status: 'ordered', purchaseOrderId: id, supplierId: proveedor.id, supplier: proveedor.name }).where(inArray(workOrderParts.id, repuestos.map((r) => r.id)))
      await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'purchase_order.created', targetId: id, targetType: 'purchase_order', metadata: { numero: folioOc(numero), proveedor: proveedor.name, repuestos: repuestos.length } })
      await sumarUso(tx, actor.tenantId, ahora, { documents: 1 })
      return numero
    })
    return c.json({ id, numero })
  })

  /** Cambiar el chofer de una orden por retirar. */
  .post('/compras/ordenes/:id/chofer', conDatos(z.object({ choferId: z.string().nullable() })), async (c) => {
    exigirGestion(c)
    const oc = await filaDelTenant(c, purchaseOrders, c.req.param('id'), 'purchase_order', 'esa orden de compra')
    if (oc.status !== 'open') throw rechazo(409, 'Esa orden de compra ya no está por retirar.')
    const { choferId } = c.req.valid('json')
    if (choferId) await exigirChofer(c, choferId)
    await c.var.base.update(purchaseOrders).set({ driverId: choferId }).where(and(eq(purchaseOrders.id, oc.id), eq(purchaseOrders.tenantId, c.var.actor.tenantId)))
    return c.json({ ok: true })
  })

  /** Recibir en el taller lo que trajo el chofer: todo, o solo algunos repuestos si no llegó todo. */
  .post('/compras/ordenes/:id/recibir', conDatos(z.object({ repuestos: z.array(z.string()).max(200).optional() })), async (c) => {
    const { actor, ahora } = c.var
    const oc = await filaDelTenant(c, purchaseOrders, c.req.param('id'), 'purchase_order', 'esa orden de compra')
    exigirQuienRecibe(c, oc.driverId)
    if (oc.status !== 'open') throw rechazo(409, 'Esa orden de compra ya no está por retirar.')
    const { repuestos } = c.req.valid('json')
    if (repuestos) await filasDelTenant(c, workOrderParts, repuestos, 'part', 'ese repuesto')
    const pedidos = await c.var.base.select().from(workOrderParts).where(and(eq(workOrderParts.purchaseOrderId, oc.id), eq(workOrderParts.tenantId, actor.tenantId), eq(workOrderParts.status, 'ordered')))
    const elegidos = repuestos ? pedidos.filter((r) => repuestos.includes(r.id)) : pedidos
    if (!elegidos.length || (repuestos && elegidos.length !== new Set(repuestos).size)) throw rechazo(409, 'Esos repuestos no están pedidos en esta orden.')
    const estado = await c.var.base.transaction(async (tx) => {
      await tx.update(workOrderParts).set({ status: 'received', receivedAt: ahora, receivedBy: actor.id }).where(inArray(workOrderParts.id, elegidos.map((r) => r.id)))
      const r = await recalcularOc(tx, oc.id, ahora)
      if (r.recienRecibida) await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'purchase_order.received', targetId: oc.id, targetType: 'purchase_order', metadata: { numero: folioOc(oc.number), proveedor: oc.supplier } })
      return r.estado
    })
    return c.json({ ok: true, estado, recibidos: elegidos.length })
  })

  /** Anular una orden de la que no ha llegado nada: lo que tenía vuelve a por pedir. */
  .post('/compras/ordenes/:id/anular', conDatos(z.object({ motivo: z.string().trim().min(3, 'Escribe el motivo.').max(500) })), async (c) => {
    exigirGestion(c)
    const { actor, ahora } = c.var
    const oc = await filaDelTenant(c, purchaseOrders, c.req.param('id'), 'purchase_order', 'esa orden de compra')
    if (oc.status !== 'open') throw rechazo(409, 'Esa orden de compra ya no está por retirar.')
    const recibidos = await c.var.base.select({ id: workOrderParts.id }).from(workOrderParts).where(and(eq(workOrderParts.purchaseOrderId, oc.id), eq(workOrderParts.status, 'received')))
    if (recibidos.length) throw rechazo(409, 'Ya llegó parte de esta orden: recibe lo que falta o déjala abierta.')
    const { motivo } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrderParts).set({ status: 'pending', purchaseOrderId: null }).where(and(eq(workOrderParts.purchaseOrderId, oc.id), eq(workOrderParts.tenantId, actor.tenantId), eq(workOrderParts.status, 'ordered')))
      await tx.update(purchaseOrders).set({ status: 'cancelled', cancelledAt: ahora, cancelReason: motivo }).where(eq(purchaseOrders.id, oc.id))
    })
    return c.json({ ok: true })
  })

  /** Recibir un repuesto suelto: el que trajo el cliente, o uno que se compró sin orden. */
  .post('/repuestos/:id/recibir', async (c) => {
    exigirGestion(c)
    const { actor, ahora } = c.var
    const r = await filaDelTenant(c, workOrderParts, c.req.param('id'), 'part', 'ese repuesto')
    if (!POR_LLEGAR.includes(r.status)) throw rechazo(409, 'Ese repuesto ya no se espera.')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrderParts).set({ status: 'received', receivedAt: ahora, receivedBy: actor.id }).where(eq(workOrderParts.id, r.id))
      if (r.purchaseOrderId) {
        const oc = await recalcularOc(tx, r.purchaseOrderId, ahora)
        if (oc.recienRecibida) await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'purchase_order.received', targetId: oc.oc.id, targetType: 'purchase_order', metadata: { numero: folioOc(oc.oc.number), proveedor: oc.oc.supplier } })
      }
    })
    return c.json({ ok: true })
  })

  /** Un repuesto que aparece con la OT abierta (una pieza que se quebró al armar): lo espera el trabajo que se diga, o el armado. */
  .post('/ot/:id/repuestos', conDatos(nuevoRepuesto), async (c) => {
    exigirGestion(c)
    const { actor, ahora } = c.var
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (!OT_EN_TALLER.includes(ot.status)) throw rechazo(409, 'A esta OT ya no se le agregan repuestos.')
    const d = c.req.valid('json')
    const proveedor = d.compra === 'shop' && d.proveedorId ? await proveedorDe(c, d.proveedorId) : null
    let necesita = null
    if (d.necesitaTareaId) {
      const t = await filaDelTenant(c, workOrderTasks, d.necesitaTareaId, 'task', 'ese trabajo')
      if (t.workOrderId !== ot.id) throw rechazo(400, 'Ese trabajo es de otra OT.')
      necesita = t.id
    } else {
      const tareas = await c.var.base
        .select({ id: workOrderTasks.id, codigo: services.code, pieza: workOrderTasks.piece, paso: workOrderTasks.step, estado: workOrderTasks.status, tipo: shopSections.kind })
        .from(workOrderTasks)
        .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
        .leftJoin(services, eq(services.id, workOrderTasks.serviceId))
        .where(and(eq(workOrderTasks.workOrderId, ot.id), eq(workOrderTasks.tenantId, actor.tenantId)))
      necesita = trabajoQueLoNecesita(tareas.map((t) => ({ ...t, diagnostico: t.tipo === 'diagnosis' })))?.id ?? null
    }
    const id = nuevoId('rep')
    const [{ ultimo }] = await c.var.base.select({ ultimo: sql<number>`coalesce(max(${workOrderParts.position}), -1)`.mapWith(Number) }).from(workOrderParts).where(eq(workOrderParts.workOrderId, ot.id))
    await c.var.base.insert(workOrderParts).values({ id, tenantId: actor.tenantId, workOrderId: ot.id, description: d.descripcion, quantity: d.cantidad, position: ultimo + 1, source: d.compra, supplierId: proveedor?.id ?? null, supplier: proveedor?.name ?? null, unitCost: d.costo ?? null, neededByTaskId: necesita, status: 'pending', createdBy: actor.id, createdAt: ahora })
    return c.json({ id })
  })
