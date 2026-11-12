// Lo que comparten las rutas de compras con las del taller: el estado de una orden de compra sale de sus repuestos, y
// los repuestos de una OT anulada ya no se esperan ni se compran.
import { and, eq, inArray } from 'drizzle-orm'
import type { Base } from '../../base'
import { estadoDeOc, POR_LLEGAR } from './reglas'
import { purchaseOrders, workOrderParts } from './tablas'

/** Recalcula y guarda el estado de una orden de compra. Dice si quedó recibida recién ahora, para anotarlo. */
export async function recalcularOc(tx: Base, ocId: string, ahora: Date) {
  const [oc] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, ocId))
  const repuestos = await tx.select({ estado: workOrderParts.status }).from(workOrderParts).where(eq(workOrderParts.purchaseOrderId, ocId))
  const estado = estadoDeOc(repuestos, Boolean(oc.cancelledAt))
  if (estado !== oc.status) await tx.update(purchaseOrders).set({ status: estado, receivedAt: estado === 'received' ? ahora : null }).where(eq(purchaseOrders.id, ocId))
  return { oc, estado, recienRecibida: estado === 'received' && oc.status !== 'received' }
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
