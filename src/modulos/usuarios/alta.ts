// El alta de personas en una rectificadora. La usan su administrador (panel de la organización), el equipo de la
// plataforma (consola) y el alta de una rectificadora nueva (su primer administrador). Revisa el cupo de usuarios del
// plan y que el correo no esté ya en la organización, y deja la cuenta con su evento en la misma transacción.
import { and, count, eq, ne, sql } from 'drizzle-orm'
import type { Base } from '../../base'
import { rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { type Origen, registrar } from '../eventos/registrar'
import { limitesDe, PLANES } from '../tenants/reglas'
import { tenants } from '../tenants/tablas'
import type { DatosPersona } from './reglas'
import { users } from './tablas'

/**
 * Cuántos usuarios ocupan el plan y cuántos permite. Ocupa un lugar quien tiene cuenta, activo o bloqueado (como lo
 * cuenta la consola); una invitación, recién al entrar.
 */
export async function cupoDeUsuarios(base: Base, tenantId: string) {
  const [t] = await base.select({ plan: tenants.plan, ajustes: tenants.limitsOverride }).from(tenants).where(eq(tenants.id, tenantId))
  const [{ usados }] = await base.select({ usados: count() }).from(users).where(and(eq(users.tenantId, tenantId), ne(users.status, 'invited')))
  return { usados, limite: limitesDe(t.plan, t.ajustes).users, plan: PLANES[t.plan].nombre }
}

/**
 * Agrega una persona a una rectificadora, dentro de la transacción `tx`. Nace activa: todavía no hay inicio de sesión
 * real ni invitación por correo (cuando existan, nacerá invitada y ocupará su lugar al entrar). `metadata` se suma al
 * evento (el motivo, cuando lo hace el equipo de la plataforma).
 */
export async function agregarPersona(tx: Base, origen: Origen, tenantId: string, d: DatosPersona, ahora: Date, metadata: Record<string, unknown> = {}) {
  // Un cerrojo por rectificadora: si dos agregan a la vez, la segunda cuenta con la primera ya adentro.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`users:${tenantId}`}))`)
  const cupo = await cupoDeUsuarios(tx, tenantId)
  if (cupo.usados >= cupo.limite) throw rechazo(409, `Se llegó al límite del plan ${cupo.plan}: ${cupo.limite} usuarios. Para sumar a alguien hay que ampliar el plan.`)
  const [repetido] = await tx.select({ nombre: users.name }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.email, d.correo)))
  if (repetido) throw rechazo(409, `Ese correo ya es de ${repetido.nombre}, en esta misma organización.`)
  const id = nuevoId('us')
  await tx.insert(users).values({ id, tenantId, name: d.nombre, email: d.correo, role: d.rol, status: 'active', createdAt: ahora })
  await registrar(tx, origen, { tenantId, eventType: 'user.created', userId: id, targetId: id, targetType: 'user', metadata: { nombre: d.nombre, correo: d.correo, rol: d.rol, ...metadata } })
  return id
}
