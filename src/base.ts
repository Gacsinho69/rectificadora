import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/node-postgres'
import { migrate as migrarPostgres } from 'drizzle-orm/node-postgres/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import pg from 'pg'
import * as esquema from './esquema'

const migraciones = fileURLToPath(new URL('../drizzle', import.meta.url))

/** La base o una transacción abierta en ella: las dos se usan igual, sea PGlite o PostgreSQL. */
export type Base = PgDatabase<PgQueryResultHKT, typeof esquema>

/** PGlite: PostgreSQL dentro de la app, en desarrollo y en las pruebas. Sin carpeta, la base vive en memoria (pruebas). */
export async function abrirBase(carpeta?: string): Promise<Base> {
  if (carpeta) mkdirSync(carpeta, { recursive: true })
  const base = drizzle({ client: new PGlite(carpeta), schema: esquema, casing: 'snake_case' })
  await migrate(base, { migrationsFolder: migraciones })
  return base
}

/** PostgreSQL de verdad, en el servidor. Las migraciones pendientes se aplican al abrir. */
export async function abrirPostgres(url: string): Promise<Base> {
  const base = drizzlePostgres({ client: new pg.Pool({ connectionString: url }), schema: esquema, casing: 'snake_case' })
  await migrarPostgres(base, { migrationsFolder: migraciones })
  return base
}
