import type { Context } from 'hono'
import type { Base } from '../../base'
import { type Entorno, ipDe } from '../../http'
import { nuevoId } from '../../ids'
import type { Actor } from '../acceso/identidad'
import { events } from './tablas'
import { type Severidad, TIPOS_DE_EVENTO, type TipoActor, type TipoEvento } from './tipos'

/** Quién hace algo y desde dónde. */
export type Origen = { actorId: string | null; actorType: TipoActor; ipAddress: string | null; userAgent: string | null; metadata?: Record<string, unknown> }

export type NuevoEvento = {
  tenantId: string | null
  eventType: TipoEvento
  severity?: Severidad
  userId?: string | null
  targetId?: string | null
  targetType?: string | null
  metadata?: Record<string, unknown>
  createdAt?: Date
}

/**
 * El origen del pedido. Si alguien del equipo actúa impersonando, el actor es esa persona del equipo (no el
 * administrador impersonado), y la impersonación queda en los datos del evento.
 */
export function origenDe(c: Context, actor: Actor = (c.var as Entorno['Variables']).actor): Origen {
  const lugar = { ipAddress: ipDe(c), userAgent: c.req.header('user-agent') ?? null }
  if (actor.tipo === 'plataforma') return { ...lugar, actorId: actor.id, actorType: 'platform_admin' }
  if (actor.impersonacion)
    return { ...lugar, actorId: actor.impersonacion.adminId, actorType: 'platform_admin', metadata: { impersonation_id: actor.impersonacion.id, impersonated_user_id: actor.id } }
  return { ...lugar, actorId: actor.id, actorType: 'user' }
}

export const SISTEMA: Origen = { actorId: null, actorType: 'system', ipAddress: null, userAgent: null }

/** Anota un evento. Va dentro de la misma transacción que el cambio: si el cambio no entra, el evento tampoco. */
export async function registrar(base: Base, origen: Origen, e: NuevoEvento) {
  const [fila] = await base
    .insert(events)
    .values({
      id: nuevoId('ev'),
      tenantId: e.tenantId,
      actorId: origen.actorId,
      actorType: origen.actorType,
      userId: e.userId ?? null,
      eventType: e.eventType,
      severity: e.severity ?? TIPOS_DE_EVENTO[e.eventType].severidad,
      targetId: e.targetId ?? null,
      targetType: e.targetType ?? null,
      metadata: { ...origen.metadata, ...e.metadata },
      ipAddress: origen.ipAddress,
      userAgent: origen.userAgent,
      createdAt: e.createdAt,
    })
    .returning()
  return fila
}
