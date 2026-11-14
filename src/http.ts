import { zValidator } from '@hono/zod-validator'
import type { Context, MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { z } from 'zod'
import type { Base } from './base'
import type { Actor } from './modulos/acceso/identidad'

/** Lo que cada pedido trae consigo. `ahora` es una sola hora para todo el pedido (y la que fijan las pruebas). */
export type Entorno = { Variables: { base: Base; actor: Actor; ahora: Date } }

export const rechazo = (estado: 400 | 401 | 403 | 404 | 409 | 413 | 429, mensaje: string) => new HTTPException(estado, { message: mensaje })

/** Revisa lo que llega con un esquema Zod; si no sirve, responde 400 con el primer motivo. */
export const conDatos = <T extends z.ZodType>(esquema: T) =>
  zValidator('json', esquema, (r) => {
    if (!r.success) throw rechazo(400, conLinea(r.error.issues[0]) ?? 'Los datos no son válidos.')
  })

/** El motivo, y si es de una línea de la lista (una cotización con 15), cuál: «… (línea 3)». */
function conLinea(problema: z.core.$ZodIssue | undefined) {
  if (!problema) return null
  const [lista, posicion] = problema.path
  return lista === 'lineas' && typeof posicion === 'number' ? `${problema.message} (línea ${posicion + 1})` : problema.message
}

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

/** Si el navegador llegó por https. Detrás del balanceador la conexión de adentro es http: lo dice `x-forwarded-proto`. */
export const esHttps = (c: Context) => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'

/** La dirección que pidió el navegador, con su puerto si lo tiene («localhost:5180», «nuble.rectificadora.cl»). */
export const hostDe = (c: Context) => (c.req.header('x-forwarded-host') ?? c.req.header('host') ?? new URL(c.req.url).host).split(',')[0].trim().toLowerCase()

const hostDeOrigen = (origen: string) => {
  try {
    return new URL(origen).host.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Contra los pedidos falsificados desde otra página (CSRF): lo que cambia algo tiene que venir de las pantallas del
 * mismo sitio. El navegador lo dice en `sec-fetch-site` y en `origin`; un programa que no es un navegador no los manda,
 * pero tampoco lleva la sesión de nadie.
 */
export const mismoSitio: MiddlewareHandler = async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'HEAD' || c.req.method === 'OPTIONS') return next()
  const sitio = c.req.header('sec-fetch-site')
  const origen = c.req.header('origin')
  if ((sitio && sitio !== 'same-origin' && sitio !== 'none') || (origen !== undefined && hostDeOrigen(origen) !== hostDe(c))) throw rechazo(403, 'Pedido rechazado: viene de otra página.')
  await next()
}
