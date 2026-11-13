import { boolean, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import type { PermisoPlataforma } from '../acceso/permisos'
import { tenants } from '../tenants/tablas'
import type { EstadoUsuario, RolTenant } from './reglas'

/** Las personas de cada cliente. Toda consulta del panel del cliente filtra por `tenant_id`. */
export const users = pgTable(
  'users',
  {
    id: text().primaryKey(),
    tenantId: text()
      .notNull()
      .references(() => tenants.id),
    name: text().notNull(),
    email: text().notNull(),
    role: text().$type<RolTenant>().notNull(),
    status: text().$type<EstadoUsuario>().notNull(),
    mfaEnabled: boolean().notNull().default(false),
    /** La clave, derivada con scrypt (`cifrarClave`). Vacía mientras la persona no acepta su invitación. */
    passwordHash: text(),
    lastLoginAt: timestamp({ withTimezone: true }),
    lastLoginIp: text(),
    invitedAt: timestamp({ withTimezone: true }),
    blockedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.tenantId, t.email), index().on(t.tenantId, t.lastLoginAt)],
)

/**
 * El equipo interno de la plataforma: el único perfil con acceso global. Va en su propia tabla, aparte de las
 * personas de los clientes, para que ninguna consulta de un cliente pueda llegar a mostrarlo ni a confundirlo.
 */
export const platformAdmins = pgTable('platform_admins', {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  /** Lo sensible (suspender, cambiar plan, impersonar…) pide su permiso aparte, además de ser del equipo. */
  permissions: text().array().$type<PermisoPlataforma[]>().notNull().default([]),
  passwordHash: text(),
  active: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
