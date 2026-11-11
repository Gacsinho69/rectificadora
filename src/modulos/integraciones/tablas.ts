import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from '../tenants/tablas'
import type { EstadoIntegracion, TipoIntegracion } from './reglas'

/** Claves de API de cada cliente. Solo se guarda el prefijo visible: la clave entera no vuelve a mostrarse. */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    prefix: text().notNull(),
    createdBy: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.tenantId)],
)

/** Webhooks, SSO y conexiones con otros sistemas. Sin secretos: esos viven aparte y nunca llegan al navegador. */
export const integrations = pgTable(
  'integrations',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    kind: text().$type<TipoIntegracion>().notNull(),
    name: text().notNull(),
    /** La URL del webhook o el proveedor (Google, Microsoft, el sistema contable). */
    target: text().notNull(),
    status: text().$type<EstadoIntegracion>().notNull(),
    lastSuccessAt: timestamp({ withTimezone: true }),
    lastFailureAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.tenantId)],
)
