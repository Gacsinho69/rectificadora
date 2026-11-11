import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from '../tenants/tablas'
import type { EstadoFactura } from './reglas'

/** Lo que se cobra cada mes. El historial de pagos es esta lista, con su estado. */
export const invoices = pgTable(
  'invoices',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    number: text().notNull().unique(),
    periodStart: timestamp({ withTimezone: true }).notNull(),
    amount: integer().notNull(),
    status: text().$type<EstadoFactura>().notNull(),
    issuedAt: timestamp({ withTimezone: true }).notNull(),
    dueAt: timestamp({ withTimezone: true }).notNull(),
    paidAt: timestamp({ withTimezone: true }),
    failureReason: text(),
  },
  (t) => [index().on(t.tenantId, t.issuedAt)],
)
