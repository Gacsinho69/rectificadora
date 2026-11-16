// Lo que se arregló en la revisión de las pantallas del taller y se puede probar sin navegador: el texto del motor dice
// lo que se cuenta, y «Entregadas este mes» abre solo las de este mes.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { textoMotor } from './pantallas/comun'
import { workOrders } from './tablas'

describe('el texto del motor', () => {
  it('con algún dato, dice lo que se cuenta y avisa lo supuesto', () => {
    const texto = textoMotor({ cilindros: null, valvulasPorCilindro: 3, culatas: 2 })!
    expect(texto).toContain('4 cilindros (sin dato)')
    expect(texto).toContain('12 válvulas (3 por cilindro)')
    expect(texto).toContain('2 culatas')
    expect(textoMotor({ cilindros: 6, valvulasPorCilindro: 4, culatas: 1 })).toBe('6 cilindros · 24 válvulas (4 por cilindro) · 1 culata')
    expect(textoMotor({ cilindros: null, valvulasPorCilindro: null, culatas: null })).toBeNull()
  })
})

describe('las órdenes entregadas este mes', () => {
  it('la lista con «este mes» trae solo las entregadas este mes, como la cifra del inicio', async () => {
    const p = await armarPrueba()
    const recibir = async () => (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'] })).cuerpo.id as string
    const [estemes, antes] = [await recibir(), await recibir()]
    await p.base.update(workOrders).set({ status: 'delivered', deliveredAt: new Date('2026-11-05T15:00:00Z') }).where(eq(workOrders.id, estemes))
    await p.base.update(workOrders).set({ status: 'delivered', deliveredAt: new Date('2026-10-20T15:00:00Z') }).where(eq(workOrders.id, antes))
    const inicio = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/inicio')).cuerpo
    const lista = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/ot?estado=delivered&delMes=1')).cuerpo
    expect(lista.filas.map((o: { id: string }) => o.id)).toEqual([estemes])
    expect(lista.total).toBe(inicio.cifras.entregadasMes)
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/ot?estado=delivered')).cuerpo.total).toBe(2)
  })
})

describe('la lista de órdenes de trabajo', () => {
  it('cuenta las abiertas por etapa (y las atrasadas), solo de su rectificadora, y ordena por entrega', async () => {
    const p = await armarPrueba()
    const recibir = async (quien: string, clienteId: string, entrega: string | null, prioridad: 'normal' | 'urgent' = 'normal') =>
      (await p.pedir(quien, 'POST', '/api/servicio/ot', { clienteId, motor: 'Cummins ISX15', piezas: ['block'], entrega, prioridad })).cuerpo.id as string
    const tarde = await recibir('us_a_jefe', 'cl_a', '2026-11-01')
    const sinFecha = await recibir('us_a_jefe', 'cl_a', null)
    const pronto = await recibir('us_a_jefe', 'cl_a', '2026-11-20')
    const urgente = await recibir('us_a_jefe', 'cl_a', '2026-11-20', 'urgent')
    await p.base.update(workOrders).set({ status: 'quality' }).where(eq(workOrders.id, pronto))
    // La de otra rectificadora no se cuenta ni aparece.
    await recibir('us_b_admin', 'cl_b', '2026-11-01')

    const lista = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/ot?orden=entrega')).cuerpo
    expect(lista.filas.map((o: { id: string }) => o.id)).toEqual([tarde, urgente, pronto, sinFecha])
    const abiertas = Object.values(lista.etapas as Record<string, { cuantas: number }>).reduce((s, e) => s + e.cuantas, 0)
    expect(abiertas).toBe(4)
    expect(lista.etapas.quality).toEqual({ cuantas: 1, atrasadas: 0 })
    const atrasadas = Object.values(lista.etapas as Record<string, { atrasadas: number }>).reduce((s, e) => s + e.atrasadas, 0)
    expect(atrasadas).toBe(1)

    const otra = (await p.pedir('us_b_admin', 'GET', '/api/servicio/ot')).cuerpo
    expect(otra.total).toBe(1)
  })
})
