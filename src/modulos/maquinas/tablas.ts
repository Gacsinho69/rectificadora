import { sql } from 'drizzle-orm'
import { boolean, date, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { services, shopSections } from '../taller/tablas'
import { tenants } from '../tenants/tablas'
import type { MotivoParada } from './reglas'

/** Las máquinas de cada rectificadora: la rectificadora de cilindros, la lineadora, la cepilladora… */
export const machines = pgTable(
  'machines',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    /** Dónde está: la sección del taller. */
    sectionId: text().references(() => shopSections.id),
    notes: text(),
    /** Cada cuántos días le toca mantención; vacío si no tiene una fija. */
    maintenanceEveryDays: integer(),
    lastMaintenanceAt: date({ mode: 'string' }),
    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.tenantId)],
)

/** Qué actividades necesitan cada máquina: si la máquina para, esos trabajos esperan. */
export const machineServices = pgTable(
  'machine_services',
  {
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    machineId: text()
      .notNull()
      .references(() => machines.id),
    serviceId: text()
      .notNull()
      .references(() => services.id),
  },
  (t) => [primaryKey({ columns: [t.machineId, t.serviceId] }), index().on(t.tenantId)],
)

/**
 * Las paradas de una máquina: en falla o en mantención. La abierta es la que no tiene `endedAt` (una a la vez); las
 * cerradas son su historia. Una mantención hecha sin parar queda como una parada que empieza y termina a la vez.
 */
export const machineStops = pgTable(
  'machine_stops',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    machineId: text()
      .notNull()
      .references(() => machines.id),
    reason: text().$type<MotivoParada>().notNull(),
    note: text(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    startedBy: text(),
    endedAt: timestamp({ withTimezone: true }),
    endedBy: text(),
  },
  (t) => [index().on(t.tenantId), index().on(t.machineId), uniqueIndex('machine_stops_una_abierta').on(t.machineId).where(sql`${t.endedAt} is null`)],
)
