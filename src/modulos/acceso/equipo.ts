// El equipo de la plataforma se arma desde la consola de comandos del servidor (`npm run equipo`): la primera persona,
// que no tiene quién la invite, y una clave de paso para quien olvidó la suya (todavía no hay correo para recuperarla).
// Cada cosa deja su evento en la misma transacción.
import { randomInt } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Base } from '../../base'
import { nuevoId } from '../../ids'
import { registrar, SISTEMA } from '../eventos/registrar'
import { platformAdmins } from '../usuarios/tablas'
import { cifrarClave } from './claves'
import { type PermisoPlataforma, TODOS_LOS_PERMISOS } from './permisos'
import { cerrarSesionesDe } from './sesion'

const DESDE = { via: 'consola de comandos del servidor' }

/** Una clave de paso, para entrar una vez y cambiarla: tres grupos de cuatro, sin letras que se confundan al dictarla. */
export function claveDePaso(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz23456789'
  const grupo = () => Array.from({ length: 4 }, () => letras[randomInt(letras.length)]).join('')
  return `${grupo()}-${grupo()}-${grupo()}`
}

const correoDe = (correo: string) => {
  const limpio = correo.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) throw new Error(`«${correo}» no parece un correo.`)
  return limpio
}

/** Suma a alguien al equipo, con todos los permisos si no se dicen otros. Devuelve su clave de paso. */
export async function agregarAlEquipo(base: Base, d: { correo: string; nombre: string; permisos?: PermisoPlataforma[] }, ahora = new Date()) {
  const correo = correoDe(d.correo)
  const nombre = d.nombre.trim()
  if (!nombre) throw new Error('Falta el nombre.')
  const permisos = d.permisos ?? TODOS_LOS_PERMISOS
  const clave = claveDePaso()
  const passwordHash = await cifrarClave(clave)
  const id = nuevoId('adm')
  await base.transaction(async (tx) => {
    const [ya] = await tx.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, correo))
    if (ya) throw new Error(`${correo} ya es del equipo. Para darle una clave de paso nueva: npm run equipo -- clave --correo ${correo}`)
    await tx.insert(platformAdmins).values({ id, name: nombre, email: correo, permissions: permisos, passwordHash, createdAt: ahora })
    await registrar(tx, SISTEMA, { tenantId: null, eventType: 'platform_admin.created', targetId: id, targetType: 'platform_admin', metadata: { ...DESDE, nombre, correo, permisos }, createdAt: ahora })
  })
  return { id, clave }
}

/** Una clave de paso nueva para alguien del equipo. Cierra sus sesiones abiertas: quien tuviera la clave anterior queda fuera. */
export async function claveDePasoDelEquipo(base: Base, correo: string, ahora = new Date()) {
  const limpio = correoDe(correo)
  const clave = claveDePaso()
  const passwordHash = await cifrarClave(clave)
  await base.transaction(async (tx) => {
    const [a] = await tx.select().from(platformAdmins).where(eq(platformAdmins.email, limpio))
    if (!a) throw new Error(`${limpio} no es del equipo.`)
    if (!a.active) throw new Error(`${limpio} está desactivado en el equipo.`)
    await tx.update(platformAdmins).set({ passwordHash }).where(eq(platformAdmins.id, a.id))
    await cerrarSesionesDe(tx, a.id, ahora)
    await registrar(tx, SISTEMA, { tenantId: null, eventType: 'user.password_changed', targetId: a.id, targetType: 'platform_admin', metadata: { ...DESDE, clave_de_paso: true }, createdAt: ahora })
  })
  return { clave }
}
