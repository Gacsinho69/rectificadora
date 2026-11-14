// Las piezas propias de cada rectificadora, además de las de siempre (motor, culata, block…). Quien rectifica también
// turbos o bombas inyectoras las agrega aquí: aparecen al recibir, en la lista de actividades, en la cotización y en la
// ruta de la OT, como una pieza suelta más. Las nombra su id, que es de la rectificadora: el de otra no sirve.
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import type { Base } from '../../base'
import { conDatos, rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { type EntornoTenant, filaDelTenant, filasDelTenant } from '../acceso/guardias'
import { esPiezaBase, PIEZAS, type Pieza, type PiezaPropia } from './reglas'
import { customPieces } from './tablas'

type C = Context<EntornoTenant>

export const MAXIMO_DE_PIEZAS = 30

/** Las piezas propias de una rectificadora, en su orden (las inactivas también: se siguen nombrando). */
export async function piezasPropias(base: Base, tenantId: string): Promise<PiezaPropia[]> {
  const filas = await base.select().from(customPieces).where(eq(customPieces.tenantId, tenantId)).orderBy(asc(customPieces.position), asc(customPieces.createdAt))
  return filas.map((p) => ({ id: p.id, nombre: p.name, activa: p.active }))
}

/**
 * Que cada pieza que llega sea de las de siempre o una propia de esta rectificadora (si es de otra, queda anotado).
 * `soloActivas`: para lo nuevo (recibir, una actividad, un trabajo), la pieza tiene que estar en uso.
 */
export async function exigirPiezas(c: C, piezas: readonly Pieza[], soloActivas: boolean) {
  const propias = [...new Set(piezas.filter((p) => !esPiezaBase(p)))]
  if (propias.some((p) => !p.startsWith('pz_'))) throw rechazo(400, 'Esa pieza no existe en tu taller.')
  const filas = await filasDelTenant(c, customPieces, propias, 'piece', 'esa pieza')
  const inactiva = filas.find((p) => !p.active)
  if (soloActivas && inactiva) throw rechazo(409, `La pieza «${inactiva.name}» ya no se usa en tu taller.`)
}

const nombre = z.string({ error: 'Escribe el nombre de la pieza.' }).trim().min(2, 'Escribe el nombre de la pieza.').max(40)

function exigirAdministrador(c: C) {
  if (c.var.actor.estadoTenant === 'suspended' || c.var.actor.estadoTenant === 'cancelled') throw rechazo(403, 'Tu organización está suspendida: puedes revisar, pero no hacer cambios.')
  if (c.var.actor.rol !== 'admin') throw rechazo(403, 'Las piezas del taller las cambia el administrador.')
}

/** Dos piezas no se llaman igual (sin contar mayúsculas), ni como una de las de siempre. */
async function exigirNombreLibre(base: Base, tenantId: string, texto: string, salvo?: string) {
  const clave = texto.toLocaleLowerCase('es')
  const deSiempre = Object.values(PIEZAS).find((n) => n.toLocaleLowerCase('es') === clave)
  if (deSiempre) throw rechazo(409, `«${deSiempre}» ya es una de las piezas de siempre.`)
  const otra = (await piezasPropias(base, tenantId)).find((p) => p.id !== salvo && p.nombre.toLocaleLowerCase('es') === clave)
  if (otra) throw rechazo(409, `Ya hay una pieza «${otra.nombre}».`)
}

export const rutasPiezas = new Hono<EntornoTenant>()
  /** Las piezas propias: todos las ven (el técnico, para saber qué pieza tiene en las manos). */
  .get('/piezas', async (c) => c.json({ propias: await piezasPropias(c.var.base, c.var.actor.tenantId) }))

  /** Una pieza nueva, al final de las propias. Solo el administrador. */
  .post('/piezas', conDatos(z.object({ nombre })), async (c) => {
    exigirAdministrador(c)
    const { base, actor, ahora } = c.var
    const d = c.req.valid('json')
    const id = nuevoId('pz')
    // De a una por taller: dos que crean «Turbo» a la vez no dejan dos piezas con el mismo nombre.
    await base.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`custom_pieces:${actor.tenantId}`}))`)
      await exigirNombreLibre(tx, actor.tenantId, d.nombre)
      const [{ cuantas }] = await tx.select({ cuantas: count() }).from(customPieces).where(eq(customPieces.tenantId, actor.tenantId))
      if (cuantas >= MAXIMO_DE_PIEZAS) throw rechazo(409, `Ya son ${MAXIMO_DE_PIEZAS} piezas propias: desactiva o renombra una que ya no uses.`)
      await tx.insert(customPieces).values({ id, tenantId: actor.tenantId, name: d.nombre, position: cuantas, active: true, createdAt: ahora })
    })
    return c.json({ id })
  })

  /** Renombrarla o dejar de usarla (no se borra: las OT y cotizaciones que la tienen la siguen nombrando). */
  .post('/piezas/:id', conDatos(z.object({ nombre: nombre.optional(), activa: z.boolean().optional() })), async (c) => {
    exigirAdministrador(c)
    const p = await filaDelTenant(c, customPieces, c.req.param('id'), 'piece', 'esa pieza')
    const d = c.req.valid('json')
    if (d.nombre !== undefined) await exigirNombreLibre(c.var.base, c.var.actor.tenantId, d.nombre, p.id)
    await c.var.base
      .update(customPieces)
      .set({ ...(d.nombre !== undefined ? { name: d.nombre } : {}), ...(d.activa !== undefined ? { active: d.activa } : {}) })
      .where(and(eq(customPieces.id, p.id), eq(customPieces.tenantId, c.var.actor.tenantId)))
    return c.json({ ok: true })
  })
