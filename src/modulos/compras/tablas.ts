import { date, index, integer, pgTable, real, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { workOrders, workOrderTasks } from '../taller/tablas'
import { tenants } from '../tenants/tablas'
import type { EstadoOc, EstadoRepuesto, QuienCompra } from './reglas'

/** Las órdenes de compra al proveedor (OC-0001, correlativa por rectificadora), con el chofer que compra y retira. */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    number: integer().notNull(),
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
    quantity: real().notNull().default(1),
    /** En el orden de la cotización; los que se agregan después, al final. */
    position: integer().notNull().default(0),
    source: text().$type<QuienCompra>().notNull(),
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
