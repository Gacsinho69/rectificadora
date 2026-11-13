import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { services } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type Seccion = { id: string; nombre: string; diagnostico: boolean; activa: boolean }

const secciones = async (p: Prueba, quien = 'us_a_admin') => (await p.pedir(quien, 'GET', '/api/servicio/catalogo')).cuerpo.secciones as Seccion[]
const deNombre = async (p: Prueba, nombre: string) => (await secciones(p)).find((s) => s.nombre === nombre)!

describe('las secciones de cada taller', () => {
  it('el administrador agrega, renombra y ordena las suyas; el tablero las muestra en ese orden', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/secciones', { nombre: 'Bombas inyectoras' })).estado).toBe(403)
    const { id } = (await p.pedir('us_a_admin', 'POST', '/api/servicio/secciones', { nombre: 'Bombas inyectoras' })).cuerpo
    expect((await secciones(p)).at(-1)).toMatchObject({ id, nombre: 'Bombas inyectoras', activa: true, diagnostico: false })
    // Sin repetir nombres, aunque cambien las mayúsculas.
    const repetida = await p.pedir('us_a_admin', 'POST', '/api/servicio/secciones', { nombre: 'culatas' })
    expect(repetida.estado).toBe(409)
    expect(repetida.cuerpo.error).toContain('«Culatas»')

    expect((await p.pedir('us_a_admin', 'POST', `/api/servicio/secciones/${id}`, { nombre: 'Bombas e inyectores' })).estado).toBe(200)
    expect((await p.pedir('us_a_admin', 'POST', `/api/servicio/secciones/${id}/mover`, { hacia: 'abajo' })).estado).toBe(409)
    expect((await p.pedir('us_a_admin', 'POST', `/api/servicio/secciones/${id}/mover`, { hacia: 'arriba' })).estado).toBe(200)
    const nombres = (await secciones(p)).map((s) => s.nombre)
    expect(nombres.slice(-2)).toEqual(['Bombas e inyectores', 'Servicios de terceros'])
    const tablero = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/taller')).cuerpo.secciones.map((s: { nombre: string }) => s.nombre)
    expect(tablero.slice(-2)).toEqual(['Bombas e inyectores', 'Servicios de terceros'])
  })

  it('se apaga solo sin actividades en uso ni trabajos por hacer; la de recepción no se apaga', async () => {
    const p = await armarPrueba()
    const recepcion = await deNombre(p, 'Recepción y diagnóstico')
    expect((await p.pedir('us_a_admin', 'POST', `/api/servicio/secciones/${recepcion.id}`, { activa: false })).cuerpo.error).toContain('no se apaga')
    const terceros = await deNombre(p, 'Servicios de terceros')
    const conActividades = await p.pedir('us_a_admin', 'POST', `/api/servicio/secciones/${terceros.id}`, { activa: false })
    expect(conActividades.estado).toBe(409)
    expect(conActividades.cuerpo.error).toContain('3 actividades en uso')
    await p.base.update(services).set({ active: false }).where(and(eq(services.tenantId, 'tn_a'), eq(services.sectionId, terceros.id)))
    expect((await p.pedir('us_a_admin', 'POST', `/api/servicio/secciones/${terceros.id}`, { activa: false })).estado).toBe(200)
    const tablero = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/taller')).cuerpo.secciones.map((s: { nombre: string }) => s.nombre)
    expect(tablero).not.toContain('Servicios de terceros')
    expect((await p.pedir('us_a_admin', 'POST', `/api/servicio/secciones/${terceros.id}`, { activa: true })).estado).toBe(200)
  })

  it('aislamiento: otra rectificadora no renombra, apaga ni mueve secciones ajenas', async () => {
    const p = await armarPrueba()
    const culatas = await deNombre(p, 'Culatas')
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/secciones/${culatas.id}`, { nombre: 'Mía' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/secciones/${culatas.id}/mover`, { hacia: 'abajo' })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(2)
    // Cada una tiene sus nombres: B puede tener su propia «Bombas inyectoras».
    await p.pedir('us_a_admin', 'POST', '/api/servicio/secciones', { nombre: 'Bombas inyectoras' })
    expect((await p.pedir('us_b_admin', 'POST', '/api/servicio/secciones', { nombre: 'Bombas inyectoras' })).estado).toBe(200)
    expect((await deNombre(p, 'Culatas')).nombre).toBe('Culatas')
  })
})
