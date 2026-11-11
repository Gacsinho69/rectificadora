import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { Severidad, TipoActor, TipoEvento } from './tipos'

/**
 * Un solo registro para todo lo que pasa: inicios de sesión, cambios, pagos, errores y accesos de soporte.
 * Es la auditoría: solo se agrega, nunca se edita ni se borra.
 */
export const events = pgTable(
  'events',
  {
    id: text().primaryKey(),
    /** Vacío solo en lo que es de la plataforma entera (un error del sistema que no es de un cliente). */
    tenantId: text(),
    /** Quién lo hizo: una persona del cliente, alguien del equipo, una clave de API o el sistema (vacío). */
    actorId: text(),
    actorType: text().$type<TipoActor>().notNull(),
    /** La persona del cliente a la que se refiere: la que entró, la bloqueada, la impersonada. */
    userId: text(),
    eventType: text().$type<TipoEvento>().notNull(),
    severity: text().$type<Severidad>().notNull().default('info'),
    targetId: text(),
    targetType: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index().on(t.tenantId, t.createdAt),
    index().on(t.eventType, t.createdAt),
    index().on(t.userId, t.createdAt),
    index().on(t.createdAt),
  ],
)
export type Evento = typeof events.$inferSelect
