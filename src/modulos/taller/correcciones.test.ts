import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { diaValido } from '../../fecha'
import { armarPrueba } from '../../pruebas'
import { diaEnChile, horasDeJornada, recontarTarea } from './reglas'
import { services, workOrderTasks } from './tablas'

describe('la hora del taller es la de Chile', () => {
  it('el día cambia a medianoche de Chile, no a las 21:00', () => {
    // 22:30 del 14 de noviembre en Chile (verano, UTC−3) ya es el 15 en UTC.
    expect(diaEnChile(new Date('2026-11-15T01:30:00Z'))).toBe('2026-11-14')
    expect(diaEnChile(new Date('2026-11-15T03:30:00Z'))).toBe('2026-11-15')
    // En invierno (UTC−4), las 23:00 del 7 de julio.
    expect(diaEnChile(new Date('2026-07-08T03:00:00Z'))).toBe('2026-07-07')
  })

  it('en invierno la jornada de 8 a 19 se cuenta en UTC−4', () => {
    const invierno = (s: string) => new Date(`${s.replace(' ', 'T')}:00-04:00`)
    // De 7:00 a 9:00 hay una hora de jornada; de 17:30 a 19:00, una y media.
    expect(horasDeJornada(invierno('2026-07-07 07:00'), invierno('2026-07-07 09:00'))).toBe(1)
    expect(horasDeJornada(invierno('2026-07-07 17:30'), invierno('2026-07-07 19:00'))).toBe(1.5)
  })

  it('una OT que vence hoy no sale atrasada en la noche', async () => {
    // 23:00 del 11 de noviembre en Chile.
    const { pedir } = await armarPrueba(new Date('2026-11-12T02:00:00Z'))
    const { id } = (await pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'], entrega: '2026-11-11' })).cuerpo
    expect((await pedir('us_a_jefe', 'GET', `/api/servicio/ot/${id}`)).cuerpo.plazo).toBe('por_vencer')
  })
})

describe('las fechas que no existen se rechazan con su motivo', () => {
  it('31 de febrero o mes 13: 400 y no un error del servidor', async () => {
    expect(diaValido('2026-02-28')).toBe(true)
    expect(diaValido('2026-02-31')).toBe(false)
    expect(diaValido('2026-13-01')).toBe(false)
    const { pedir } = await armarPrueba()
    const r = await pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'], entrega: '2026-02-31' })
    expect(r.estado).toBe(400)
    expect((await pedir('us_a_admin', 'GET', '/api/organizacion/eventos?desde=2026-13-01')).estado).toBe(400)
  })
})

describe('corregir el motor de una OT cuenta de nuevo sus trabajos', () => {
  it('recontarTarea cambia solo lo contado por el motor, no lo escrito a mano', () => {
    const cuatro = { cilindros: 4, valvulasPorCilindro: 2, culatas: 1 }
    const seis = { ...cuatro, cilindros: 6 }
    expect(recontarTarea({ nombre: 'Rectificado de cilindros (4 cilindros)', cantidad: 4, minutos: 240, criterio: 'per_cylinder' }, cuatro, seis)).toEqual({ cantidad: 6, nombre: 'Rectificado de cilindros (6 cilindros)', minutos: 360 })
    expect(recontarTarea({ nombre: 'Rectificado de cilindros (3 cilindros)', cantidad: 3, minutos: 180, criterio: 'per_cylinder' }, cuatro, seis)).toBeNull()
    expect(recontarTarea({ nombre: 'Pintura de motor', cantidad: 1, minutos: 60, criterio: 'fixed' }, cuatro, seis)).toBeNull()
  })

  it('de 4 a 6 cilindros: el trabajo pendiente pasa a 6 y sus horas suben', async () => {
    const { pedir, base } = await armarPrueba()
    const [porCilindro] = await base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.criterion, 'per_cylinder')))
    const { id } = (await pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo
    expect((await pedir('us_a_jefe', 'POST', `/api/servicio/ot/${id}/tareas`, { trabajoId: porCilindro.id })).estado).toBe(200)
    const tarea = async () => (await base.select().from(workOrderTasks).where(and(eq(workOrderTasks.workOrderId, id), eq(workOrderTasks.serviceId, porCilindro.id))))[0]
    expect((await tarea()).quantity).toBe(4)
    expect((await pedir('us_a_jefe', 'POST', `/api/servicio/ot/${id}`, { cilindros: 6 })).estado).toBe(200)
    const t = await tarea()
    expect(t).toMatchObject({ quantity: 6, stdMinutes: Math.round(porCilindro.stdHours * 6 * 60) })
    expect(t.name).toContain('6 cilindros')
  })
})

describe('lo apagado de la lista no entra a una OT', () => {
  it('una actividad desactivada no se agrega a una OT', async () => {
    const { pedir, base } = await armarPrueba()
    const [actividad] = await base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.criterion, 'fixed')))
    await base.update(services).set({ active: false }).where(eq(services.id, actividad.id))
    const { id } = (await pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo
    expect((await pedir('us_a_jefe', 'POST', `/api/servicio/ot/${id}/tareas`, { trabajoId: actividad.id })).estado).toBe(409)
  })

  it('asignar a «nadie» es null, no un texto vacío', async () => {
    const { pedir, base } = await armarPrueba()
    const { id } = (await pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo
    const [t] = await base.select().from(workOrderTasks).where(eq(workOrderTasks.workOrderId, id))
    expect((await pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${t.id}/asignar`, { usuario: '' })).estado).toBe(400)
  })
})
