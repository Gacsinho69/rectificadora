export const ESTADOS_FACTURA = { paid: 'Pagada', open: 'Por cobrar', past_due: 'Vencida', failed: 'Pago fallido', cancelled: 'Anulada' } as const
export type EstadoFactura = keyof typeof ESTADOS_FACTURA
