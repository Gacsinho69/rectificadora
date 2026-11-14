// Lo que se arregló en la revisión de máquinas: lo que de verdad espera, la parada al sacarla de uso, la última
// mantención en el futuro, detener dos veces a la vez y el aislamiento de la mantención.
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { services, workOrderTasks } from '../taller/tablas'
import { machineStops } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type Maquina = { id: string; trabajos: number; parada: { motivo: string } | null; actividades: { id: string; trabajos: number }[] }
const actividad = async (p: Prueba, codigo: string) => (await p.base.select().from(services).where(and(eq(services.tenantId, 'tn_a'), eq(services.code, codigo))))[0]
const lista = async (p: Prueba) => (await p.pedir('us_a_jefe', 'GET', '/api/servicio/maquinas')).cuerpo as Maquina[]

/** Un block con su lineado (B-05) agregado a la OT, para hacerse. */
async function lineadoPorHacer(p: Prueba) {
  const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'], diagnostico: false })).cuerpo
  const b05 = await actividad(p, 'B-05')
  expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/tareas`, { trabajoId: b05.id })).estado).toBe(200)
  const [t] = await p.base.select().from(workOrderTasks).where(eq(workOrderTasks.workOrderId, otId))
  return { b05: b05.id, tarea: t.id }
}

describe('lo que espera a una máquina', () => {
  it('lo que ya está en proceso no cuenta como esperando, y dos máquinas detenidas con la misma actividad no lo cuentan dos veces', async () => {
    const p = await armarPrueba()
    const { b05, tarea } = await lineadoPorHacer(p)
    const uno = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora 1', actividades: [b05] })).cuerpo.id
    await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora 2', actividades: [b05] })
    let maquinas = await lista(p)
    expect(maquinas.map((m) => m.trabajos)).toEqual([1, 1])
    expect(maquinas[0].actividades).toEqual([expect.objectContaining({ id: b05, trabajos: 1 })])
    // Ya en proceso: sigue aunque la máquina pare, así que no espera.
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${tarea}/iniciar`)).estado).toBe(200)
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${uno}/detener`, { motivo: 'maintenance' })
    maquinas = await lista(p)
    expect(maquinas.map((m) => m.trabajos)).toEqual([0, 0])
  })
})

describe('las paradas y la mantención', () => {
  it('sacar de uso una máquina detenida cierra su parada: al volver a usarla no reaparece', async () => {
    const p = await armarPrueba()
    const { b05 } = await lineadoPorHacer(p)
    const { id } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora', actividades: [b05] })).cuerpo
    await p.pedir('us_a_member', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'breakdown', nota: 'No avanza el carro' })
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${id}`, { nombre: 'Lineadora', actividades: [b05], activa: false })).estado).toBe(200)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${id}`, { nombre: 'Lineadora', actividades: [b05], activa: true })).estado).toBe(200)
    expect((await lista(p))[0].parada).toBeNull()
  })

  it('la última mantención no puede ser una fecha futura', async () => {
    const p = await armarPrueba()
    const r = await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora', cadaDias: 60, ultima: '2027-01-11' })
    expect(r.estado).toBe(400)
    expect(r.cuerpo.error).toContain('futura')
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora', cadaDias: 60, ultima: '2026-11-01' })).estado).toBe(200)
  })

  it('dos que la detienen a la vez: una parada, y el otro sabe que ya está detenida', async () => {
    const p = await armarPrueba()
    const { id } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora' })).cuerpo
    const r = await Promise.all([1, 2].map(() => p.pedir('us_a_member', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'maintenance' })))
    expect(r.map((x) => x.estado).sort()).toEqual([200, 409])
    expect(await p.base.select().from(machineStops).where(eq(machineStops.machineId, id))).toHaveLength(1)
    expect(await p.eventos('system.error')).toHaveLength(0)
  })

  it('aislamiento: otra rectificadora no anota la mantención de una máquina ajena', async () => {
    const p = await armarPrueba()
    const { id } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora', cadaDias: 60 })).cuerpo
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/maquinas/${id}/mantencion`, {})).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(1)
    expect(await p.base.select().from(machineStops).where(eq(machineStops.machineId, id))).toHaveLength(0)
  })
})
