// El alta de personas en una rectificadora. La usan su administrador (panel de la organización), el equipo de la
// plataforma (consola) y el alta de una rectificadora nueva (su primer administrador). Revisa el cupo de usuarios del
// plan y que el correo no esté ya en la organización, y deja la invitación con su evento en la misma transacción.
//
// La persona nace invitada: recibe un enlace (por ahora lo entrega quien la agrega, por WhatsApp o correo) y con él
// define su clave y entra. El enlace vence a los 7 días; se puede pedir uno nuevo, que anula el anterior.
import { and, count, desc, eq, isNull, ne, sql } from 'drizzle-orm'
import type { Base } from '../../base'
import { rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { nuevoSecreto } from '../acceso/claves'
import { invitations } from '../acceso/tablas'
import { type Origen, registrar } from '../eventos/registrar'
import { events } from '../eventos/tablas'
import { limitesDe, PLANES } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import type { DatosPersona } from './reglas'
import { users } from './tablas'

export const DIAS_DE_INVITACION = 7

/** Cuántos usuarios ocupan el plan y cuántos permite. Ocupa un lugar toda cuenta: activa, bloqueada o invitada. */
export async function cupoDeUsuarios(base: Base, tenantId: string) {
  const [t] = await base.select({ plan: tenants.plan, ajustes: tenants.limitsOverride }).from(tenants).where(eq(tenants.id, tenantId))
  const [{ usados }] = await base.select({ usados: count() }).from(users).where(eq(users.tenantId, tenantId))
  return { usados, limite: limitesDe(t.plan, t.ajustes).users, plan: PLANES[t.plan].nombre }
}

/** Lo que recibe quien agrega a alguien: el enlace para que defina su clave, y hasta cuándo sirve. */
export type Invitacion = { enlace: string; vence: string }

/**
 * Un enlace de invitación nuevo para una persona invitada, dentro de la transacción `tx`. Anula los anteriores sin
 * usar. Se guarda solo la huella del secreto: el enlace se ve una vez, al crearlo.
 */
export async function nuevaInvitacion(tx: Base, tenantId: string, userId: string, creadoPor: string | null, ahora: Date): Promise<Invitacion> {
  await tx.update(invitations).set({ expiresAt: ahora }).where(and(eq(invitations.userId, userId), isNull(invitations.usedAt), sql`${invitations.expiresAt} > ${ahora.toISOString()}`))
  const { secreto, huella } = nuevoSecreto()
  const vence = new Date(ahora.getTime() + DIAS_DE_INVITACION * 86_400_000)
  await tx.insert(invitations).values({ id: nuevoId('inv'), tenantId, userId, tokenHash: huella, createdBy: creadoPor, createdAt: ahora, expiresAt: vence })
  return { enlace: `/invitacion/${secreto}`, vence: vence.toISOString() }
}

/**
 * Agrega una persona a una rectificadora, dentro de la transacción `tx`: queda invitada, con su enlace. `metadata` se
 * suma al evento (el motivo, cuando lo hace el equipo de la plataforma).
 */
export async function agregarPersona(tx: Base, origen: Origen, tenantId: string, d: DatosPersona, ahora: Date, metadata: Record<string, unknown> = {}) {
  // Un cerrojo por rectificadora: si dos agregan a la vez, la segunda cuenta con la primera ya adentro.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`users:${tenantId}`}))`)
  const cupo = await cupoDeUsuarios(tx, tenantId)
  if (cupo.usados >= cupo.limite) throw rechazo(409, `Se llegó al límite del plan ${cupo.plan}: ${cupo.limite} usuarios. Para sumar a alguien hay que ampliar el plan.`)
  const [repetido] = await tx.select({ nombre: users.name, estado: users.status }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.email, d.correo)))
  if (repetido)
    throw rechazo(
      409,
      repetido.estado === 'invited'
        ? `${repetido.nombre} ya tiene una invitación con ese correo: si no le llegó o venció, pide un «Enlace nuevo» desde su fila.`
        : repetido.estado === 'blocked'
          ? `Ese correo es de ${repetido.nombre}, que tiene la cuenta bloqueada: se desbloquea desde su fila.`
          : `Ese correo ya es de ${repetido.nombre}, en esta misma organización.`,
    )
  const id = nuevoId('us')
  await tx.insert(users).values({ id, tenantId, name: d.nombre, email: d.correo, role: d.rol, status: 'invited', invitedAt: ahora, createdAt: ahora })
  const invitacion = await nuevaInvitacion(tx, tenantId, id, origen.actorId, ahora)
  await registrar(tx, origen, { tenantId, eventType: 'user.invited', userId: id, targetId: id, targetType: 'user', metadata: { nombre: d.nombre, correo: d.correo, rol: d.rol, ...metadata } })
  return { id, ...invitacion }
}

/**
 * Que siempre quede al menos un administrador activo: si no, la organización queda sin quien la administre (y el equipo
 * no puede entrar como él). Se cuenta dentro de la transacción del cambio y con su cerrojo: dos que bloquean a la vez no
 * dejan a los dos fuera. Vale para el panel del cliente y para la consola.
 */
export async function exigirOtroAdmin(tx: Base, tenantId: string, sinEste: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`admins:${tenantId}`}))`)
  const [{ otros }] = await tx
    .select({ otros: count() })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, sinEste)))
  if (otros === 0) throw rechazo(409, 'Debe quedar al menos un administrador activo en la organización.')
}

/** Si a esa persona la bloqueó el equipo de la plataforma (por abuso, una cuenta robada): el cliente no la desbloquea. */
export async function laBloqueoLaPlataforma(base: Base, userId: string) {
  const [ultimo] = await base.select({ actor: events.actorType }).from(events).where(and(eq(events.eventType, 'user.blocked'), eq(events.userId, userId))).orderBy(desc(events.createdAt)).limit(1)
  return ultimo?.actor === 'platform_admin'
}

/** Un enlace nuevo para quien no alcanzó a usar el suyo (venció, se perdió). Solo para invitaciones pendientes. */
export async function reenviarInvitacion(tx: Base, origen: Origen, tenantId: string, u: { id: string; status: string }, ahora: Date, metadata: Record<string, unknown> = {}) {
  if (u.status !== 'invited') throw rechazo(409, 'Esa persona ya aceptó su invitación: entra con su correo y su clave.')
  const invitacion = await nuevaInvitacion(tx, tenantId, u.id, origen.actorId, ahora)
  // «Enviada» dice cuándo salió el enlace que sirve, no el primero.
  await tx.update(users).set({ invitedAt: ahora }).where(eq(users.id, u.id))
  await registrar(tx, origen, { tenantId, eventType: 'user.invited', userId: u.id, targetId: u.id, targetType: 'user', metadata: { enlace_nuevo: true, ...metadata } })
  return invitacion
}
