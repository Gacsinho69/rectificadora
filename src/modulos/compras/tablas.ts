import { boolean, date, index, integer, pgTable, real, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { workOrders, workOrderTasks } from '../taller/tablas'
import { tenants } from '../tenants/tablas'
import type { EstadoOc, EstadoRepuesto, QuienCompra, TipoMovimiento } from './reglas'

/**
 * Los proveedores de cada rectificadora: a quién le compra los repuestos. No se borran (sus órdenes quedan): se
 * desactivan y dejan de ofrecerse.
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    /** El nombre sin mayúsculas, tildes ni espacios (`claveDeProveedor`): no se repite dentro de la rectificadora. */
    nameKey: text().notNull(),
    taxId: text(),
    contact: text(),
    phone: text(),
    email: text(),
    /** Dónde se retira: el chofer la ve en su retiro. */
    address: text(),
    /** Qué vende, cómo se le paga, horario de bodega. */
    notes: text(),
    active: boolean().notNull().default(true),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.tenantId, t.nameKey)],
)

/** Las órdenes de compra al proveedor (OC-0001, correlativa por rectificadora), con el chofer que compra y retira. */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    number: integer().notNull(),
    /** El proveedor de la lista. Vacío solo en órdenes anteriores a la lista cuyo nombre no se pudo reconocer. */
    supplierId: text().references(() => suppliers.id),
    /** Su nombre, guardado junto a la orden para leerla sin buscar; al corregir el nombre en la lista se corrige aquí. */
    supplier: text().notNull(),
    /** Quién va a comprar y retirar: el chofer de compras (cualquier persona del taller que pueda tomar trabajos). */
    driverId: text(),
    /** Cuándo se espera en el taller. */
    expectedAt: date({ mode: 'string' }),
    notes: text(),
    /** Calculado de sus repuestos (`estadoDeOc`); se guarda para filtrar rápido. */
    status: text().$type<EstadoOc>().notNull(),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
  },
  (t) => [unique().on(t.tenantId, t.number), index().on(t.tenantId, t.status), index().on(t.tenantId, t.driverId)],
)

/**
 * Los repuestos de cada OT: lo que se cotizó (o se agregó después), quién lo consigue y si ya llegó. Mientras no llega,
 * el trabajo que lo necesita espera.
 */
export const workOrderParts = pgTable(
  'work_order_parts',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    workOrderId: text()
      .notNull()
      .references(() => workOrders.id),
    /** La cotización de la que vino; vacío si se agregó en la OT. */
    quoteId: text(),
    description: text().notNull(),
    /** Lo que el comprador necesita para pedir lo correcto: la marca, el código del fabricante y la medida (STD, 0,25…). */
    brand: text(),
    partNumber: text(),
    size: text(),
    quantity: real().notNull().default(1),
    /** En el orden de la cotización; los que se agregan después, al final. */
    position: integer().notNull().default(0),
    source: text().$type<QuienCompra>().notNull(),
    /** A quién se piensa comprar (el de la cotización) o a quién se pidió (el de su orden de compra), con su nombre. */
    supplierId: text().references(() => suppliers.id),
    supplier: text(),
    /** Costo por unidad, sin IVA. Interno: el cliente ve el precio de la cotización. */
    unitCost: integer(),
    /** El trabajo que no se puede empezar sin él: el armado, si no se dijo otro. */
    neededByTaskId: text().references(() => workOrderTasks.id),
    status: text().$type<EstadoRepuesto>().notNull(),
    purchaseOrderId: text().references(() => purchaseOrders.id),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp({ withTimezone: true }),
    receivedBy: text(),
  },
  (t) => [index().on(t.workOrderId), index().on(t.tenantId, t.status), index().on(t.purchaseOrderId)],
)

/**
 * Los insumos de la bodega: lo que el taller gasta y no es de una OT (aceite de prueba, pasta de esmeril, piedras de
 * bruñir). Bajo su mínimo, aparecen en compras para pedirlos.
 */
export const supplies = pgTable(
  'supplies',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    /** Cómo se cuenta: litro, kilo, unidad, caja. */
    unit: text().notNull(),
    brand: text(),
    partNumber: text(),
    /** A quién se le compra de costumbre. */
    supplierId: text().references(() => suppliers.id),
    /** Con esto o menos, hay que pedir. */
    minStock: real().notNull().default(0),
    /** Lo que hay en bodega. Se mueve solo con `moverInsumo`, junto con su movimiento. */
    stock: real().notNull().default(0),
    /** Costo por unidad, sin IVA. Interno. */
    unitCost: integer(),
    notes: text(),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.tenantId)],
)

/** Lo que entra y sale de la bodega: compras (al recibir la orden), consumos y ajustes del conteo. */
export const supplyMovements = pgTable(
  'supply_movements',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    supplyId: text()
      .notNull()
      .references(() => supplies.id),
    /** Positivo si entra, negativo si sale. */
    quantity: real().notNull(),
    kind: text().$type<TipoMovimiento>().notNull(),
    /** Para qué OT se sacó, si se dijo. */
    workOrderId: text().references(() => workOrders.id),
    purchaseOrderId: text().references(() => purchaseOrders.id),
    note: text(),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.supplyId), index().on(t.tenantId)],
)

/** Los insumos pedidos en una orden de compra, junto a sus repuestos: se reciben igual, y al recibirse entran a bodega. */
export const purchaseOrderSupplies = pgTable(
  'purchase_order_supplies',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    purchaseOrderId: text()
      .notNull()
      .references(() => purchaseOrders.id),
    supplyId: text()
      .notNull()
      .references(() => supplies.id),
    quantity: real().notNull(),
    unitCost: integer(),
    status: text().$type<EstadoRepuesto>().notNull(),
    receivedAt: timestamp({ withTimezone: true }),
    receivedBy: text(),
  },
  (t) => [index().on(t.purchaseOrderId), index().on(t.tenantId, t.status)],
)
