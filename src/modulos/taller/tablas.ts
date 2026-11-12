import { sql } from 'drizzle-orm'
import { boolean, date, index, integer, pgTable, primaryKey, real, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { tenants } from '../tenants/tablas'
import { users } from '../usuarios/tablas'
import type { Criterio, EstadoOt, EstadoTarea, MotivoDetencion, Pieza, PrioridadOt } from './reglas'

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

/**
 * Las actividades de cada rectificadora: qué se hace, a qué pieza, cómo se cuenta al cotizar (por cilindro, válvula,
 * biela, culata o una vez), cuánto vale cada unidad y en qué lugar de la ruta de su pieza va.
 */
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
    /** La unidad con que se lee el precio: «cilindro», «válvula», «block». */
    unit: text().notNull(),
    /** Cómo se cuenta al cotizar, con los datos del motor: por cilindro, válvula, biela, culata o una vez. */
    criterion: text().$type<Criterio>().notNull().default('fixed'),
    /** Pesos sin IVA por unidad; vacío en los de terceros, que se cotizan a mano. */
    price: integer(),
    /** Horas estándar por unidad. */
    stdHours: real().notNull().default(0),
    /** La pieza sobre la que se hace; `motor` es lo de toda la OT (desarme, armado, control final). */
    piece: text().$type<Pieza>().notNull().default('motor'),
    /** Su lugar en la ruta de la pieza: va después de los de número menor; con el mismo número, a la vez. */
    step: integer().notNull().default(100),
    /** Va en el desglose típico de su pieza (el botón «Desglose por pieza» de la cotización). */
    typical: boolean().notNull().default(false),
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
    /** Lo que se sabe del motor para contar por cilindro, válvula, biela o culata. Vacío hasta saberlo. */
    cylinders: integer(),
    valvesPerCylinder: integer(),
    heads: integer(),
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
    /** La pieza y el paso se copian del trabajo de la lista al crearse: la OT sigue la ruta con que se vendió. */
    piece: text().$type<Pieza>().notNull().default('motor'),
    step: integer().notNull().default(100),
    status: text().$type<EstadoTarea>().notNull(),
    assignedTo: text(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    finishedBy: text(),
    /** Adelantado por el jefe de taller: se puede empezar aunque falte lo anterior de su ruta. */
    advancedAt: timestamp({ withTimezone: true }),
    advancedBy: text(),
  },
  (t) => [index().on(t.workOrderId), index().on(t.tenantId, t.sectionId, t.status), index().on(t.tenantId, t.assignedTo)],
)

/** Quién hace cada actividad (sus especialistas): entre ellos se reparten solos los trabajos nuevos de esa actividad. */
export const serviceSpecialists = pgTable(
  'service_specialists',
  {
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    serviceId: text()
      .notNull()
      .references(() => services.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.userId] }), index().on(t.tenantId)],
)

/**
 * Las detenciones de un trabajo: faltan repuestos, falta la respuesta del cliente, la pieza está donde un tercero. La
 * abierta es la que no tiene `resolvedAt` (una a la vez); las cerradas quedan en la historia de la OT.
 */
export const taskHolds = pgTable(
  'task_holds',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    taskId: text()
      .notNull()
      .references(() => workOrderTasks.id),
    workOrderId: text()
      .notNull()
      .references(() => workOrders.id),
    reason: text().$type<MotivoDetencion>().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: text(),
    resolvedAt: timestamp({ withTimezone: true }),
    resolvedBy: text(),
  },
  (t) => [index().on(t.workOrderId), index().on(t.tenantId), uniqueIndex().on(t.taskId).where(sql`${t.resolvedAt} is null`)],
)
