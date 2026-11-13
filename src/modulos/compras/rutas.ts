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
import { type EntornoTenant, exigirQuePuedaEditar, filaDelTenant, filasDelTenant } from '../acceso/guardias'
import { customers } from '../comercial/tablas'
import { origenDe, registrar } from '../eventos/registrar'
import { exigirGestion, gestiona, siguienteNumero, sumarUso, veMontos } from '../taller/comun'
import { OT_EN_TALLER } from '../taller/reparto'
import { plazoDeOt } from '../taller/reglas'
import { diaDe } from '../plataforma/panorama'
import { services, shopSections, workOrders, workOrderTasks } from '../taller/tablas'
import { users } from '../usuarios/tablas'
import { moverInsumo, recalcularOc } from './comun'
import { bajoMinimo, cantidadSugerida, claveDeProveedor, type DatosInsumo, type DatosProveedor, folioOc, insumoSchema, POR_LLEGAR, proveedorSchema, QUIEN_COMPRA, trabajoQueLoNecesita } from './reglas'
import { purchaseOrders, purchaseOrderSupplies, suppliers, supplies, supplyMovements, workOrderParts } from './tablas'

type C = Context<EntornoTenant>
const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]
const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const nuevaOrden = z.object({
  repuestos: z.array(z.string()).max(200).default([]),
  /** Insumos de bodega, con cuánto pedir de cada uno. */
  insumos: z.array(z.object({ insumoId: z.string(), cantidad: z.number().positive('La cantidad debe ser mayor que cero.').max(1_000_000) })).max(200).default([]),
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
  medida: z.string().trim().max(40).optional(),
  marca: z.string().trim().max(60).optional(),
  codigo: z.string().trim().max(60).optional(),
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

/** Lo que se guarda de un insumo: lo vacío queda sin dato. */
const datosDeInsumo = (d: DatosInsumo) => ({ name: d.nombre, unit: d.unidad, minStock: d.minimo, brand: d.marca || null, partNumber: d.codigo || null, supplierId: d.proveedorId || null, unitCost: d.costo ?? null, notes: d.nota || null })

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
      .select({ r: workOrderParts, ot: { id: workOrders.id, numero: workOrders.number, motor: workOrders.engine, entrega: workOrders.dueDate, prioridad: workOrders.priority, estado: workOrders.status }, cliente: customers.name, necesita: workOrderTasks.name })
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
    const [listaInsumos, lineasInsumos] = await Promise.all([
      base.select({ s: supplies, proveedor: suppliers.name }).from(supplies).leftJoin(suppliers, eq(suppliers.id, supplies.supplierId)).where(and(eq(supplies.tenantId, actor.tenantId), eq(supplies.active, true))).orderBy(asc(supplies.name)),
      base.select().from(purchaseOrderSupplies).where(and(eq(purchaseOrderSupplies.tenantId, actor.tenantId), or(eq(purchaseOrderSupplies.status, 'ordered'), visibles.length ? inArray(purchaseOrderSupplies.purchaseOrderId, visibles.map((o) => o.id)) : undefined))),
    ])
    const insumoDe = new Map(listaInsumos.map((x) => [x.s.id, x]))
    const enCamino = (id: string) => lineasInsumos.filter((l) => l.supplyId === id && l.status === 'ordered').reduce((s, l) => s + l.quantity, 0)
    const lineaInsumo = (l: (typeof lineasInsumos)[number]) => ({ id: l.id, insumoId: l.supplyId, nombre: insumoDe.get(l.supplyId)?.s.name ?? '—', unidad: insumoDe.get(l.supplyId)?.s.unit ?? '', cantidad: l.quantity, costo: montos ? l.unitCost : null, estado: l.status, recibido: iso(l.receivedAt) })
    const repuesto = ({ r, ot, cliente, necesita }: (typeof filas)[number]) => ({
      id: r.id,
      descripcion: r.description,
      cantidad: r.quantity,
      medida: r.size,
      marca: r.brand,
      codigo: r.partNumber,
      compra: r.source,
      proveedorId: montos ? r.supplierId : null,
      proveedor: montos ? r.supplier : null,
      costo: montos ? r.unitCost : null,
      estado: r.status,
      ot: { id: ot.id, numero: ot.numero, motor: ot.motor, entrega: ot.entrega, prioridad: ot.prioridad, plazo: plazoDeOt(ot.entrega, ot.estado, diaDe(c.var.ahora)) },
      cliente,
      necesita,
      ocId: r.purchaseOrderId,
      recibido: iso(r.receivedAt),
      creado: r.createdAt.toISOString(),
    })
    return c.json({
      porPedir: filas.filter(({ r }) => r.source === 'shop' && r.status === 'pending').map(repuesto),
      clientes: filas.filter(({ r }) => r.source === 'customer' && r.status === 'pending').map(repuesto),
      // Los insumos que quedan en su mínimo o menos, contando lo que ya viene en camino.
      insumosBajos: listaInsumos
        .filter(({ s }) => bajoMinimo(s.stock + enCamino(s.id), s.minStock))
        .map(({ s, proveedor }) => ({ id: s.id, nombre: s.name, unidad: s.unit, marca: s.brand, codigo: s.partNumber, stock: s.stock, minimo: s.minStock, porLlegar: enCamino(s.id), sugerido: cantidadSugerida(s.stock, s.minStock, enCamino(s.id)), proveedorId: montos ? s.supplierId : null, proveedor: montos ? proveedor : null, costo: montos ? s.unitCost : null })),
      ordenes: visibles.map((o) => {
        const suyos = filas.filter(({ r }) => r.purchaseOrderId === o.id)
        const insumos = lineasInsumos.filter((l) => l.purchaseOrderId === o.id)
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
          costo: montos ? suyos.reduce((s, { r }) => s + Math.round((r.unitCost ?? 0) * r.quantity), 0) + insumos.reduce((s, l) => s + Math.round((l.unitCost ?? 0) * l.quantity), 0) : null,
          repuestos: suyos.map(repuesto),
          insumos: insumos.map(lineaInsumo),
        }
      }),
    })
  })

  /** Emitir una orden de compra: los repuestos elegidos quedan pedidos a un proveedor de la lista, con el chofer que va a buscarlos. */
  .post('/compras/ordenes', conDatos(nuevaOrden), async (c) => {
    exigirGestion(c)
    const { actor, ahora } = c.var
    const d = c.req.valid('json')
    if (!d.repuestos.length && !d.insumos.length) throw rechazo(400, 'Elige qué pedir.')
    const repuestos = await filasDelTenant(c, workOrderParts, d.repuestos, 'part', 'ese repuesto')
    if (repuestos.some((r) => r.source !== 'shop' || r.status !== 'pending')) throw rechazo(409, 'Solo se piden los repuestos que compra la rectificadora y que están por pedir.')
    const insumos = await filasDelTenant(c, supplies, d.insumos.map((i) => i.insumoId), 'supply', 'ese insumo')
    if (insumos.some((s) => !s.active)) throw rechazo(409, 'Un insumo de la orden está fuera de uso.')
    const costoDe = new Map(insumos.map((s) => [s.id, s.unitCost]))
    const proveedor = await proveedorDe(c, d.proveedorId)
    if (!proveedor.active) throw rechazo(409, `${proveedor.name} está inactivo: actívalo en Proveedores o elige otro.`)
    if (d.choferId) await exigirChofer(c, d.choferId)
    const id = nuevoId('oc')
    const numero = await c.var.base.transaction(async (tx) => {
      const numero = await siguienteNumero(tx, purchaseOrders, actor.tenantId)
      await tx.insert(purchaseOrders).values({ id, tenantId: actor.tenantId, number: numero, supplierId: proveedor.id, supplier: proveedor.name, driverId: d.choferId ?? null, expectedAt: d.llega ?? null, notes: d.nota || null, status: 'open', createdBy: actor.id, createdAt: ahora })
      if (repuestos.length) await tx.update(workOrderParts).set({ status: 'ordered', purchaseOrderId: id, supplierId: proveedor.id, supplier: proveedor.name }).where(inArray(workOrderParts.id, repuestos.map((r) => r.id)))
      if (d.insumos.length) await tx.insert(purchaseOrderSupplies).values(d.insumos.map((i) => ({ id: nuevoId('ocl'), tenantId: actor.tenantId, purchaseOrderId: id, supplyId: i.insumoId, quantity: i.cantidad, unitCost: costoDe.get(i.insumoId) ?? null, status: 'ordered' as const })))
      await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'purchase_order.created', targetId: id, targetType: 'purchase_order', metadata: { numero: folioOc(numero), proveedor: proveedor.name, repuestos: repuestos.length, insumos: d.insumos.length } })
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

  /** Recibir en el taller lo que trajo el chofer: todo, o solo algunos repuestos o insumos si no llegó todo. Los insumos entran a bodega. */
  .post('/compras/ordenes/:id/recibir', conDatos(z.object({ repuestos: z.array(z.string()).max(200).optional(), insumos: z.array(z.string()).max(200).optional() })), async (c) => {
    const { actor, ahora } = c.var
    const oc = await filaDelTenant(c, purchaseOrders, c.req.param('id'), 'purchase_order', 'esa orden de compra')
    exigirQuienRecibe(c, oc.driverId)
    if (oc.status !== 'open') throw rechazo(409, 'Esa orden de compra ya no está por retirar.')
    const { repuestos, insumos } = c.req.valid('json')
    // Sin decir qué, es todo lo que falta; diciendo, solo eso.
    const todo = !repuestos && !insumos
    if (repuestos) await filasDelTenant(c, workOrderParts, repuestos, 'part', 'ese repuesto')
    const pedidos = await c.var.base.select().from(workOrderParts).where(and(eq(workOrderParts.purchaseOrderId, oc.id), eq(workOrderParts.tenantId, actor.tenantId), eq(workOrderParts.status, 'ordered')))
    const lineas = await c.var.base.select().from(purchaseOrderSupplies).where(and(eq(purchaseOrderSupplies.purchaseOrderId, oc.id), eq(purchaseOrderSupplies.tenantId, actor.tenantId), eq(purchaseOrderSupplies.status, 'ordered')))
    const elegidos = todo ? pedidos : pedidos.filter((r) => repuestos?.includes(r.id))
    const lineasElegidas = todo ? lineas : lineas.filter((l) => insumos?.includes(l.id))
    if ((!elegidos.length && !lineasElegidas.length) || (repuestos && elegidos.length !== new Set(repuestos).size) || (insumos && lineasElegidas.length !== new Set(insumos).size)) throw rechazo(409, 'Eso no está pedido en esta orden.')
    const estado = await c.var.base.transaction(async (tx) => {
      if (elegidos.length) await tx.update(workOrderParts).set({ status: 'received', receivedAt: ahora, receivedBy: actor.id }).where(inArray(workOrderParts.id, elegidos.map((r) => r.id)))
      for (const l of lineasElegidas) {
        await tx.update(purchaseOrderSupplies).set({ status: 'received', receivedAt: ahora, receivedBy: actor.id }).where(eq(purchaseOrderSupplies.id, l.id))
        await moverInsumo(tx, { tenantId: actor.tenantId, insumoId: l.supplyId, cantidad: l.quantity, tipo: 'purchase', ocId: oc.id, nota: folioOc(oc.number), por: actor.id, ahora })
      }
      const r = await recalcularOc(tx, oc.id, ahora)
      if (r.recienRecibida) await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'purchase_order.received', targetId: oc.id, targetType: 'purchase_order', metadata: { numero: folioOc(oc.number), proveedor: oc.supplier } })
      return r.estado
    })
    return c.json({ ok: true, estado, recibidos: elegidos.length + lineasElegidas.length })
  })

  /** Anular una orden de la que no ha llegado nada: lo que tenía vuelve a por pedir. */
  .post('/compras/ordenes/:id/anular', conDatos(z.object({ motivo: z.string().trim().min(3, 'Escribe el motivo.').max(500) })), async (c) => {
    exigirGestion(c)
    const { actor, ahora } = c.var
    const oc = await filaDelTenant(c, purchaseOrders, c.req.param('id'), 'purchase_order', 'esa orden de compra')
    if (oc.status !== 'open') throw rechazo(409, 'Esa orden de compra ya no está por retirar.')
    const recibidos = await c.var.base.select({ id: workOrderParts.id }).from(workOrderParts).where(and(eq(workOrderParts.purchaseOrderId, oc.id), eq(workOrderParts.status, 'received')))
    const insumosRecibidos = await c.var.base.select({ id: purchaseOrderSupplies.id }).from(purchaseOrderSupplies).where(and(eq(purchaseOrderSupplies.purchaseOrderId, oc.id), eq(purchaseOrderSupplies.status, 'received')))
    if (recibidos.length || insumosRecibidos.length) throw rechazo(409, 'Ya llegó parte de esta orden: recibe lo que falta o déjala abierta.')
    const { motivo } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrderParts).set({ status: 'pending', purchaseOrderId: null }).where(and(eq(workOrderParts.purchaseOrderId, oc.id), eq(workOrderParts.tenantId, actor.tenantId), eq(workOrderParts.status, 'ordered')))
      await tx.update(purchaseOrderSupplies).set({ status: 'cancelled' }).where(and(eq(purchaseOrderSupplies.purchaseOrderId, oc.id), eq(purchaseOrderSupplies.tenantId, actor.tenantId), eq(purchaseOrderSupplies.status, 'ordered')))
      await tx.update(purchaseOrders).set({ status: 'cancelled', cancelledAt: ahora, cancelReason: motivo }).where(eq(purchaseOrders.id, oc.id))
    })
    return c.json({ ok: true })
  })

/** Los insumos de la bodega: lo que hay, su mínimo, lo que viene en camino y sus últimos movimientos. */
  .get('/insumos', async (c) => {
    const { base, actor } = c.var
    const montos = veMontos(actor.rol)
    const [lista, enCamino, movimientos, nombres] = await Promise.all([
      base.select({ s: supplies, proveedor: suppliers.name }).from(supplies).leftJoin(suppliers, eq(suppliers.id, supplies.supplierId)).where(eq(supplies.tenantId, actor.tenantId)).orderBy(desc(supplies.active), asc(supplies.name)),
      base
        .select({ insumo: purchaseOrderSupplies.supplyId, cantidad: sql<number>`sum(${purchaseOrderSupplies.quantity})`.mapWith(Number) })
        .from(purchaseOrderSupplies)
        .where(and(eq(purchaseOrderSupplies.tenantId, actor.tenantId), eq(purchaseOrderSupplies.status, 'ordered')))
        .groupBy(purchaseOrderSupplies.supplyId),
      base
        .select({ m: supplyMovements, ot: workOrders.number })
        .from(supplyMovements)
        .leftJoin(workOrders, eq(workOrders.id, supplyMovements.workOrderId))
        .where(eq(supplyMovements.tenantId, actor.tenantId))
        .orderBy(desc(supplyMovements.createdAt))
        .limit(500),
      nombresDe(c),
    ])
    const porLlegar = new Map(enCamino.map((e) => [e.insumo, e.cantidad]))
    return c.json(
      lista.map(({ s, proveedor }) => ({
        id: s.id,
        nombre: s.name,
        unidad: s.unit,
        marca: s.brand,
        codigo: s.partNumber,
        proveedorId: montos ? s.supplierId : null,
        proveedor: montos ? proveedor : null,
        costo: montos ? s.unitCost : null,
        minimo: s.minStock,
        stock: s.stock,
        porLlegar: porLlegar.get(s.id) ?? 0,
        bajo: bajoMinimo(s.stock, s.minStock),
        nota: s.notes,
        activo: s.active,
        movimientos: movimientos
          .filter(({ m }) => m.supplyId === s.id)
          .slice(0, 5)
          .map(({ m, ot }) => ({ id: m.id, tipo: m.kind, cantidad: m.quantity, ot, nota: m.note, quien: m.createdBy ? (nombres.get(m.createdBy) ?? null) : null, en: m.createdAt.toISOString() })),
      })),
    )
  })

  .post('/insumos', conDatos(insumoSchema), async (c) => {
    exigirGestion(c)
    const d = c.req.valid('json')
    if (d.proveedorId) await proveedorDe(c, d.proveedorId)
    const id = nuevoId('ins')
    await c.var.base.insert(supplies).values({ id, tenantId: c.var.actor.tenantId, ...datosDeInsumo(d), active: d.activo ?? true, createdAt: c.var.ahora })
    return c.json({ id })
  })

  /** Corregir un insumo, o sacarlo de uso. El stock no se cambia aquí: se ajusta con su motivo. */
  .post('/insumos/:id', conDatos(insumoSchema), async (c) => {
    exigirGestion(c)
    const s = await filaDelTenant(c, supplies, c.req.param('id'), 'supply', 'ese insumo')
    const d = c.req.valid('json')
    if (d.proveedorId) await proveedorDe(c, d.proveedorId)
    await c.var.base.update(supplies).set({ ...datosDeInsumo(d), active: d.activo ?? s.active }).where(and(eq(supplies.id, s.id), eq(supplies.tenantId, c.var.actor.tenantId)))
    return c.json({ ok: true })
  })

  /** Sacar de bodega lo que se usó (para una OT, si se dice). Lo hace cualquiera que trabaje. */
  .post('/insumos/:id/sacar', conDatos(z.object({ cantidad: z.number().positive('La cantidad debe ser mayor que cero.').max(1_000_000), otId: z.string().nullable().optional(), nota: z.string().trim().max(300).optional() })), async (c) => {
    exigirQuePuedaEditar(c)
    const s = await filaDelTenant(c, supplies, c.req.param('id'), 'supply', 'ese insumo')
    if (!s.active) throw rechazo(409, 'Ese insumo está fuera de uso.')
    const d = c.req.valid('json')
    if (d.otId) await filaDelTenant(c, workOrders, d.otId, 'work_order', 'esa orden de trabajo')
    if (d.cantidad > s.stock) throw rechazo(409, `Solo quedan ${s.stock} ${s.unit}. Si hay más en bodega, que el jefe de taller ajuste el stock.`)
    const { actor, ahora } = c.var
    const stock = await c.var.base.transaction((tx) => moverInsumo(tx, { tenantId: actor.tenantId, insumoId: s.id, cantidad: -d.cantidad, tipo: 'use', otId: d.otId ?? null, nota: d.nota || null, por: actor.id, ahora }))
    return c.json({ ok: true, stock })
  })

  /** Ajustar el stock a lo que se contó en bodega, con su motivo: queda la diferencia como movimiento. */
  .post('/insumos/:id/ajustar', conDatos(z.object({ stock: z.number().min(0, 'El stock no puede ser negativo.').max(1_000_000), nota: z.string({ error: 'Escribe el motivo del ajuste.' }).trim().min(3, 'Escribe el motivo del ajuste.').max(300) })), async (c) => {
    exigirGestion(c)
    const s = await filaDelTenant(c, supplies, c.req.param('id'), 'supply', 'ese insumo')
    const d = c.req.valid('json')
    if (d.stock === s.stock) throw rechazo(409, 'El stock ya es ese.')
    const { actor, ahora } = c.var
    await c.var.base.transaction((tx) => moverInsumo(tx, { tenantId: actor.tenantId, insumoId: s.id, cantidad: d.stock - s.stock, tipo: 'adjust', nota: d.nota, por: actor.id, ahora }))
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
    await c.var.base.insert(workOrderParts).values({ id, tenantId: actor.tenantId, workOrderId: ot.id, description: d.descripcion, size: d.medida || null, brand: d.marca || null, partNumber: d.codigo || null, quantity: d.cantidad, position: ultimo + 1, source: d.compra, supplierId: proveedor?.id ?? null, supplier: proveedor?.name ?? null, unitCost: d.costo ?? null, neededByTaskId: necesita, status: 'pending', createdBy: actor.id, createdAt: ahora })
    return c.json({ id })
  })
