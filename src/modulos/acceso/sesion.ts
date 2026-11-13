// Las sesiones de verdad: entrar con correo y clave abre una sesión (la cookie «sesion» lleva un secreto al azar y
// vence a los 30 días), y cada pedido sabe quién es por ella. Salir la cierra; bloquear a alguien cierra las suyas.
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Base } from '../../base'
import { ipDe } from '../../http'
import { nuevoId } from '../../ids'
import { huellaDe, nuevoSecreto } from './claves'
import { adminPorId, type Identidad, personaPorId } from './identidad'
import { sessions } from './tablas'

export const DIAS_DE_SESION = 30
const COOKIE = 'sesion'

/** Abre una sesión para quien entró y deja su cookie. */
export async function abrirSesion(c: Context, base: Base, quien: { tipo: 'user' | 'platform_admin'; id: string }, ahora: Date) {
  const { secreto, huella } = nuevoSecreto()
  const vence = new Date(ahora.getTime() + DIAS_DE_SESION * 86_400_000)
  await base.insert(sessions).values({ id: nuevoId('ses'), tokenHash: huella, actorType: quien.tipo, actorId: quien.id, createdAt: ahora, expiresAt: vence, ip: ipDe(c), userAgent: c.req.header('user-agent') ?? null })
  setCookie(c, COOKIE, secreto, { path: '/', httpOnly: true, sameSite: 'Lax', secure: new URL(c.req.url).protocol === 'https:', expires: vence })
}

/** Cierra la sesión de este navegador. */
export async function cerrarSesion(c: Context, base: Base, ahora: Date) {
  const secreto = getCookie(c, COOKIE)
  deleteCookie(c, COOKIE, { path: '/' })
  if (secreto) await base.update(sessions).set({ revokedAt: ahora }).where(and(eq(sessions.tokenHash, huellaDe(secreto)), isNull(sessions.revokedAt)))
}

/** Cierra todas las sesiones de una persona: al bloquearla, o al cambiar su clave. */
export const cerrarSesionesDe = (base: Base, actorId: string, ahora: Date) => base.update(sessions).set({ revokedAt: ahora }).where(and(eq(sessions.actorId, actorId), isNull(sessions.revokedAt)))

/** Quién pide, por su sesión: vigente, sin cerrar, y la persona sigue activa (lo revisan `adminPorId` y `personaPorId`). */
export const identidadPorSesion =
  (base: Base): Identidad =>
  async (c) => {
    const secreto = getCookie(c, COOKIE)
    if (!secreto) return null
    const ahora = (c.get('ahora') as Date | undefined) ?? new Date()
    const [s] = await base.select().from(sessions).where(and(eq(sessions.tokenHash, huellaDe(secreto)), isNull(sessions.revokedAt), gt(sessions.expiresAt, ahora)))
    if (!s) return null
    return s.actorType === 'platform_admin' ? adminPorId(base, s.actorId) : personaPorId(base, s.actorId)
  }

/** La primera identidad que reconoce a quien pide. En desarrollo: la sesión y, si no hay, «Entrar como». */
export const primeraQueReconozca =
  (...identidades: Identidad[]): Identidad =>
  async (c) => {
    for (const identidad of identidades) {
      const actor = await identidad(c)
      if (actor) return actor
    }
    return null
  }
