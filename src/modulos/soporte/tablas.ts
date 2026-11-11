import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from '../tenants/tablas'
import { platformAdmins, users } from '../usuarios/tablas'

/**
 * Cada vez que alguien del equipo entra como el administrador de un cliente: quién, a qué cliente, como quién,
 * cuándo empezó y terminó, por qué y desde qué IP. Además queda su evento de inicio y de fin en la auditoría.
 */
export const impersonations = pgTable(
  'impersonations',
  {
    id: text().primaryKey(),
    adminId: text()
      .notNull()
      .references(() => platformAdmins.id),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    reason: text().notNull(),
    adminIp: text(),
    userAgent: text(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Vence sola: nadie queda dentro de un cliente por olvido. */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    endedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.tenantId, t.startedAt), index().on(t.adminId)],
)
