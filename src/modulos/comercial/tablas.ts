import { index, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { tenants } from '../tenants/tablas'
import type { EstadoCotizacion, Linea } from './reglas'

/** Los clientes de cada rectificadora: empresas de transporte, mineras, agrícolas, particulares. */
export const customers = pgTable(
  'customers',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    taxId: text(),
    contact: text(),
    phone: text(),
    email: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.tenantId)],
)

/**
 * Las cotizaciones. Las líneas van juntas en el documento: una cotización enviada no se edita (se anula y se hace
 * otra), así que no hace falta tocarlas una por una. Los totales quedan guardados como se enviaron.
 */
export const quotes = pgTable(
  'quotes',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    number: integer().notNull(),
    customerId: text().notNull(),
    workOrderId: text(),
    engine: text().notNull(),
    /** Los datos del motor con que se contaron las líneas por cilindro, válvula, biela o culata. */
    cylinders: integer(),
    valvesPerCylinder: integer(),
    heads: integer(),
    lines: jsonb().$type<Linea[]>().notNull(),
    discountPct: integer().notNull().default(0),
    net: integer().notNull(),
    tax: integer().notNull(),
    total: integer().notNull(),
    notes: text(),
    status: text().$type<EstadoCotizacion>().notNull(),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
  },
  (t) => [unique().on(t.tenantId, t.number), index().on(t.tenantId, t.status), index().on(t.tenantId, t.createdAt)],
)
