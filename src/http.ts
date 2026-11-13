import { zValidator } from '@hono/zod-validator'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { z } from 'zod'
import type { Base } from './base'
import type { Actor } from './modulos/acceso/identidad'

/** Lo que cada pedido trae consigo. `ahora` es una sola hora para todo el pedido (y la que fijan las pruebas). */
export type Entorno = { Variables: { base: Base; actor: Actor; ahora: Date } }

export const rechazo = (estado: 400 | 401 | 403 | 404 | 409 | 429, mensaje: string) => new HTTPException(estado, { message: mensaje })

/** Revisa lo que llega con un esquema Zod; si no sirve, responde 400 con el primer motivo. */
export const conDatos = <T extends z.ZodType>(esquema: T) =>
  zValidator('json', esquema, (r) => {
    if (!r.success) throw rechazo(400, r.error.issues[0]?.message ?? 'Los datos no son válidos.')
  })

export const conFiltros = <T extends z.ZodType>(esquema: T) =>
  zValidator('query', esquema, (r) => {
    if (!r.success) throw rechazo(400, r.error.issues[0]?.message ?? 'Los filtros no son válidos.')
  })

/**
 * La IP de quien pide. Detrás del balanceador viene en `x-forwarded-for` (la primera es la del navegador); sin él, la
 * de la conexión. Si la app quedara expuesta sin balanceador, ese encabezado lo puede inventar cualquiera.
 */
export function ipDe(c: Context): string | null {
  const reenviada = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  if (reenviada) return reenviada
  const entorno = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  return entorno?.incoming?.socket?.remoteAddress ?? null
}
