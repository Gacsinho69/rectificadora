import { boolean, index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { EstadoPago, EstadoTenant, Funcion, Limites, Plan, Region } from './reglas'

/** Cada cliente de la plataforma (una rectificadora). Todo lo demás cuelga de su id. */
export const tenants = pgTable(
  'tenants',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    /** El subdominio: `<slug>.<dominio de la plataforma>`. */
    slug: text().notNull().unique(),
    customDomain: text(),
    region: text().$type<Region>().notNull(),
    status: text().$type<EstadoTenant>().notNull(),
    plan: text().$type<Plan>().notNull(),
    /** Lo que se ajustó a mano sobre los límites del plan. */
    limitsOverride: jsonb().$type<Partial<Limites>>().notNull().default({}),
    featureFlags: jsonb().$type<Partial<Record<Funcion, boolean>>>().notNull().default({}),
    billingEmail: text().notNull(),
    billingStatus: text().$type<EstadoPago>().notNull(),
    /** Ingreso mensual recurrente, en pesos. Enterprise puede tener precio negociado. */
    mrr: integer().notNull().default(0),
    nextBillingAt: timestamp({ withTimezone: true }),
    trialEndsAt: timestamp({ withTimezone: true }),
    /** El cliente permite que soporte entre como su administrador. Sin esto, nadie de la plataforma puede impersonar. */
    supportAccess: boolean().notNull().default(true),
    mfaRequired: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.status), index().on(t.createdAt)],
)
export type FilaTenant = typeof tenants.$inferSelect
