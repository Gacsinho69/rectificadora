import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { inicioDelDiaEnChile } from '../taller/reglas'
import { registrar } from './registrar'
import { events } from './tablas'

describe('el filtro de fechas de la auditoría', () => {
  it('usa los días de Chile: «hasta el 14» incluye lo de las 22:00 del 14', async () => {
    expect(inicioDelDiaEnChile('2026-11-14').toISOString()).toBe('2026-11-14T03:00:00.000Z')
    expect(inicioDelDiaEnChile('2026-07-07').toISOString()).toBe('2026-07-07T04:00:00.000Z')
    const p = await armarPrueba(new Date('2026-11-15T12:00:00Z'))
    // 22:30 del 14 de noviembre en Chile.
    const e = await registrar(p.base, { actorId: 'us_a_admin', actorType: 'user', ipAddress: null, userAgent: null }, { tenantId: 'tn_a', eventType: 'user.role_changed', metadata: {} })
    await p.base.update(events).set({ createdAt: new Date('2026-11-15T01:30:00Z') }).where(eq(events.id, e.id))
    const filas = (await p.pedir('us_a_admin', 'GET', '/api/organizacion/eventos?desde=2026-11-14&hasta=2026-11-14&tipo=user.role_changed')).cuerpo.filas
    expect(filas).toHaveLength(1)
  })
})
