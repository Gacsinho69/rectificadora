import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from '../tenants/tablas'
import { users } from '../usuarios/tablas'

/**
 * Las sesiones abiertas: quién entró (una persona de una rectificadora o alguien del equipo), desde dónde y hasta
 * cuándo vale. La cookie lleva un secreto al azar; aquí se guarda solo su huella (sha256), así una copia de la base no
 * sirve para entrar. Al salir, o al bloquear a la persona, la sesión se cierra.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey(),
    tokenHash: text().notNull().unique(),
    actorType: text().$type<'user' | 'platform_admin'>().notNull(),
    actorId: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    ip: text(),
    userAgent: text(),
  },
  (t) => [index().on(t.actorId)],
)

/**
 * Las invitaciones: el enlace con que una persona nueva define su clave y entra por primera vez. Como la sesión, se
 * guarda solo la huella del secreto. Vence a los 7 días; una nueva anula la anterior.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    tokenHash: text().notNull().unique(),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.userId)],
)
