import { boolean, date, index, integer, pgTable, real, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { tenants } from '../tenants/tablas'
import type { EstadoOt, EstadoTarea, Pieza, PrioridadOt } from './reglas'

/** Las secciones del taller de cada rectificadora (culatas, block…). `kind` marca la de recepción y diagnóstico. */
export const shopSections = pgTable(
  'shop_sections',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    kind: text().$type<'diagnosis' | 'work'>().notNull(),
    position: integer().notNull(),
    active: boolean().notNull().default(true),
  },
  (t) => [index().on(t.tenantId)],
)

/** La lista de trabajos con precio de cada rectificadora. */
export const services = pgTable(
  'services',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    sectionId: text()
      .notNull()
      .references(() => shopSections.id),
    code: text().notNull(),
    name: text().notNull(),
    unit: text().notNull(),
    /** Pesos sin IVA; vacío en los de terceros, que se cotizan a mano. */
    price: integer(),
    stdHours: real().notNull().default(0),
    active: boolean().notNull().default(true),
  },
  (t) => [unique().on(t.tenantId, t.code)],
)

/** Las órdenes de trabajo: un motor o un juego de piezas que entra al taller. El número es correlativo por cliente. */
export const workOrders = pgTable(
  'work_orders',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    number: integer().notNull(),
    customerId: text().notNull(),
    /** La cotización aceptada que la llenó de trabajos, o la que está esperando respuesta. */
    quoteId: text(),
    engine: text().notNull(),
    engineSerial: text(),
    /** El bus, camión o máquina de donde viene, con su patente o número interno. */
    equipment: text(),
    pieces: text().array().$type<Pieza[]>().notNull(),
    complaint: text(),
    priority: text().$type<PrioridadOt>().notNull().default('normal'),
    dueDate: date({ mode: 'string' }),
    /** Calculado de sus tareas y su cotización (`estadoDeOt`); se guarda para filtrar rápido. */
    status: text().$type<EstadoOt>().notNull(),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    qcApprovedAt: timestamp({ withTimezone: true }),
    qcApprovedBy: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    deliveredTo: text(),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),
  },
  (t) => [unique().on(t.tenantId, t.number), index().on(t.tenantId, t.status), index().on(t.tenantId, t.createdAt)],
)

/** Los trabajos de una OT, cada uno en su sección: la cola de cada sección sale de aquí. */
export const workOrderTasks = pgTable(
  'work_order_tasks',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    workOrderId: text()
      .notNull()
      .references(() => workOrders.id),
    sectionId: text()
      .notNull()
      .references(() => shopSections.id),
    serviceId: text(),
    name: text().notNull(),
    quantity: real().notNull().default(1),
    /** Minutos estándar del trabajo completo (horas de la lista × cantidad). */
    stdMinutes: integer().notNull().default(0),
    position: integer().notNull(),
    status: text().$type<EstadoTarea>().notNull(),
    assignedTo: text(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    finishedBy: text(),
  },
  (t) => [index().on(t.workOrderId), index().on(t.tenantId, t.sectionId, t.status), index().on(t.tenantId, t.assignedTo)],
)
