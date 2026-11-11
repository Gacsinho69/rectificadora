import { date, integer, jsonb, pgTable, primaryKey, text } from 'drizzle-orm/pg-core'
import type { UsoClave } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'

/** El uso de cada cliente, un registro por día. El mes en curso se suma de aquí; el almacenamiento es el del último día. */
export const usageDaily = pgTable(
  'usage_daily',
  {
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    day: date({ mode: 'string' }).notNull(),
    apiCalls: integer().notNull().default(0),
    storageMb: integer().notNull().default(0),
    workOrders: integer().notNull().default(0),
    quotes: integer().notNull().default(0),
    documents: integer().notNull().default(0),
    messages: integer().notNull().default(0),
    /** Cuántas veces se usó cada función clave ese día. */
    features: jsonb().$type<Partial<Record<UsoClave, number>>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day] })],
)
