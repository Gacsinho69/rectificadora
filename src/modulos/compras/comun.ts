// Lo que comparten las rutas de compras con las del taller: el estado de una orden de compra sale de sus repuestos, y
// los repuestos de una OT anulada ya no se esperan ni se compran.
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Base } from '../../base'
import { nuevoId } from '../../ids'
import { estadoDeOc, POR_LLEGAR, type TipoMovimiento } from './reglas'
import { purchaseOrders, purchaseOrderSupplies, supplies, supplyMovements, workOrderParts } from './tablas'

/** Recalcula y guarda el estado de una orden de compra (de sus repuestos y sus insumos). Dice si quedó recibida recién ahora, para anotarlo. */
export async function recalcularOc(tx: Base, ocId: string, ahora: Date) {
  const [oc] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, ocId))
  const repuestos = await tx.select({ estado: workOrderParts.status }).from(workOrderParts).where(eq(workOrderParts.purchaseOrderId, ocId))
  const insumos = await tx.select({ estado: purchaseOrderSupplies.status }).from(purchaseOrderSupplies).where(eq(purchaseOrderSupplies.purchaseOrderId, ocId))
  const estado = estadoDeOc([...repuestos, ...insumos], Boolean(oc.cancelledAt))
  if (estado !== oc.status) await tx.update(purchaseOrders).set({ status: estado, receivedAt: estado === 'received' ? ahora : null }).where(eq(purchaseOrders.id, ocId))
  return { oc, estado, recienRecibida: estado === 'received' && oc.status !== 'received' }
}

/**
 * Mueve el stock de un insumo y deja su movimiento, en la misma transacción: positivo entra (una compra, un ajuste
 * hacia arriba), negativo sale (un consumo). Devuelve el stock que queda.
 */
export async function moverInsumo(tx: Base, m: { tenantId: string; insumoId: string; cantidad: number; tipo: TipoMovimiento; otId?: string | null; ocId?: string | null; nota?: string | null; por: string; ahora: Date }) {
  const [s] = await tx.update(supplies).set({ stock: sql`${supplies.stock} + ${m.cantidad}` }).where(and(eq(supplies.id, m.insumoId), eq(supplies.tenantId, m.tenantId))).returning({ stock: supplies.stock })
  await tx.insert(supplyMovements).values({ id: nuevoId('mov'), tenantId: m.tenantId, supplyId: m.insumoId, quantity: m.cantidad, kind: m.tipo, workOrderId: m.otId ?? null, purchaseOrderId: m.ocId ?? null, note: m.nota ?? null, createdBy: m.por, createdAt: m.ahora })
  return s.stock
}

/** Los repuestos de una OT anulada ya no se esperan; las órdenes de compra donde iban se recalculan. */
export async function anularRepuestosDeOt(tx: Base, tenantId: string, otId: string, ahora: Date) {
  const anulados = await tx
    .update(workOrderParts)
    .set({ status: 'cancelled' })
    .where(and(eq(workOrderParts.workOrderId, otId), eq(workOrderParts.tenantId, tenantId), inArray(workOrderParts.status, POR_LLEGAR)))
    .returning({ oc: workOrderParts.purchaseOrderId })
  for (const oc of new Set(anulados.map((a) => a.oc).filter((x): x is string => Boolean(x)))) await recalcularOc(tx, oc, ahora)
}
