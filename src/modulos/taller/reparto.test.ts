import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { users } from '../usuarios/tablas'
import { services, shopSections } from './tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type TareaOt = { id: string; nombre: string; situacion: string; espera: string[]; asignadoId: string | null; pieza: string; grupo: string; detencion: { motivo: string } | null }

const recepcion = { clienteId: 'cl_a', motor: 'Mercedes-Benz OM 457', piezas: ['motor'], cilindros: 6, valvulasPorCilindro: 4, culatas: 1 }

async function actividad(base: Prueba['base'], codigo: string, tenantId = 'tn_a') {
  const [t] = await base.select().from(services).where(and(eq(services.tenantId, tenantId), eq(services.code, codigo)))
  return t
}

/** La línea de una actividad, contada para el motor de 6 cilindros y 24 válvulas. */
async function linea(base: Prueba['base'], codigo: string) {
  const t = await actividad(base, codigo)
  const cantidad = t.criterion === 'per_valve' ? 24 : t.criterion === 'per_cylinder' || t.criterion === 'per_rod' ? 6 : 1
  return { tipo: 'trabajo', trabajoId: t.id, seccionId: t.sectionId, codigo: t.code, descripcion: t.name, cantidad, precio: t.price ?? 50_000, horas: t.stdHours, pieza: t.piece, criterio: t.criterion }
}

/** Recibe el motor, termina su diagnóstico, cotiza estas actividades y el cliente acepta. */
async function motorAprobado(p: Prueba, codigos: string[]) {
  const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo
  for (const t of (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas) {
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${t.id}/terminar`)
  }
  const lineas = await Promise.all(codigos.map((c) => linea(p.base, c)))
  const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: recepcion.motor, cilindros: 6, valvulasPorCilindro: 4, culatas: 1, lineas })).cuerpo
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})
  return otId as string
}

async function tareasDe(p: Prueba, otId: string): Promise<TareaOt[]> {
  return (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas
}
const llamada = (tareas: TareaOt[], inicio: string) => tareas.find((t) => t.nombre.startsWith(inicio))!

describe('el reparto del trabajo por pieza', () => {
  it('un motor completo: el diagnóstico primero, cada pieza en su ruta y el armado espera a todas', async () => {
    const p = await armarPrueba()
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo
    const [desarme, medicion] = await tareasDe(p, otId)
    expect([desarme.situacion, medicion.situacion]).toEqual(['available', 'waiting'])
    const r = await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${medicion.id}/iniciar`)
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('Desarme y lavado de motor')
    await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${desarme.id}/terminar`)
    await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${medicion.id}/terminar`)

    // Se cotiza también el desarme (se cobra), pero ese trabajo ya estaba: no se repite.
    const lineas = await Promise.all(['D-01', 'C-01', 'C-02', 'B-01', 'A-01'].map((c) => linea(p.base, c)))
    const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: recepcion.motor, cilindros: 6, valvulasPorCilindro: 4, culatas: 1, lineas })).cuerpo
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})

    const ot = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo
    const tareas: TareaOt[] = ot.tareas
    expect(tareas.filter((t) => t.nombre === 'Desarme y lavado de motor')).toHaveLength(1)
    expect(tareas.map((t) => t.nombre)).toEqual([
      'Desarme y lavado de motor',
      'Medición y metrología (informe)',
      'Cepillado de culata',
      'Rectificado de asientos de válvula (24 válvulas)',
      'Rectificado de cilindros (6 cilindros)',
      'Armado de motor completo (6 cilindros)',
    ])
    expect(Object.fromEntries(tareas.map((t) => [t.nombre.split(' (')[0], t.situacion]))).toMatchObject({
      'Cepillado de culata': 'available',
      'Rectificado de asientos de válvula': 'waiting',
      'Rectificado de cilindros': 'available',
      'Armado de motor completo': 'waiting',
    })
    expect(llamada(tareas, 'Armado').espera).toEqual(['Cepillado de culata', 'Rectificado de cilindros (6 cilindros)', 'Rectificado de asientos de válvula (24 válvulas)'])
    expect(ot.porPieza.map((g: { clave: string }) => g.clave)).toEqual(['diagnostico', 'culata', 'block', 'motor'])
    expect(ot).toMatchObject({ cilindros: 6, valvulasPorCilindro: 4, culatas: 1 })

    // Lo que espera su turno no se inicia; el jefe lo adelanta y entonces sí.
    const asientos = llamada(tareas, 'Rectificado de asientos')
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${asientos.id}/iniciar`)).estado).toBe(409)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${asientos.id}/adelantar`)).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${asientos.id}/adelantar`)).estado).toBe(200)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${asientos.id}/iniciar`)).estado).toBe(200)
    const historia = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.historia.map((h: { que: string }) => h.que)
    expect(historia).toContain('Adelantado: Rectificado de asientos de válvula (24 válvulas)')

    // El tablero muestra cada cosa en su lugar.
    const tablero = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/taller')).cuerpo
    const armado = tablero.secciones.find((s: { nombre: string }) => s.nombre === 'Armado')
    expect(armado.tareas[0]).toMatchObject({ situacion: 'waiting', pieza: 'motor' })
  })

  it('detener y reanudar: lo detenido sale de la cola, dice por qué y queda en la historia', async () => {
    const p = await armarPrueba()
    const otId = await motorAprobado(p, ['B-01', 'B-02'])
    const cilindros = llamada(await tareasDe(p, otId), 'Rectificado de cilindros')
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${cilindros.id}/detener`, { motivo: 'other' })).estado).toBe(400)
    expect((await p.pedir('us_a_lector', 'POST', `/api/servicio/tareas/${cilindros.id}/detener`, { motivo: 'parts' })).estado).toBe(403)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${cilindros.id}/detener`, { motivo: 'parts', nota: 'Pistones 0,50' })).estado).toBe(200)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${cilindros.id}/detener`, { motivo: 'parts' })).estado).toBe(409)

    const detenida = llamada(await tareasDe(p, otId), 'Rectificado de cilindros')
    expect(detenida).toMatchObject({ situacion: 'held', detencion: { motivo: 'parts', nota: 'Pistones 0,50' } })
    const r = await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${cilindros.id}/iniciar`)
    expect(r.estado).toBe(409)
    expect(r.cuerpo.error).toContain('detenido')
    const inicio = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/inicio')).cuerpo
    expect(inicio.cifras.detenidos).toBe(1)
    expect((await p.pedir('us_a_jefe', 'GET', '/api/servicio/ot')).cuerpo.filas[0].detenidas).toBe(1)

    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${cilindros.id}/reanudar`)).estado).toBe(200)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${cilindros.id}/reanudar`)).estado).toBe(409)
    expect(llamada(await tareasDe(p, otId), 'Rectificado de cilindros').situacion).toBe('available')
    const historia = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.historia.map((h: { que: string }) => h.que)
    expect(historia).toContain('Detenido: Rectificado de cilindros (6 cilindros) (faltan repuestos: Pistones 0,50)')
    expect(historia).toContain('Reanudado: Rectificado de cilindros (6 cilindros)')
  })

  it('cada actividad va a sus especialistas: la pieza no cambia de manos y, si no, al que tiene menos horas', async () => {
    const p = await armarPrueba()
    await p.base.insert(users).values({ id: 'us_a_tec2', tenantId: 'tn_a', name: 'Zoe Culatera', email: 'zoe@tn_a.test', role: 'technician', status: 'active' })
    const hacen = async (codigo: string, usuarios: string[]) => (await p.pedir('us_a_jefe', 'POST', `/api/servicio/catalogo/${(await actividad(p.base, codigo)).id}/especialistas`, { usuarios })).estado
    for (const codigo of ['D-01', 'D-02']) expect(await hacen(codigo, ['us_a_member'])).toBe(200)
    expect(await hacen('C-01', ['us_a_member', 'us_a_tec2'])).toBe(200)
    expect(await hacen('C-02', ['us_a_member', 'us_a_tec2'])).toBe(200)
    expect(await hacen('B-01', ['us_a_member'])).toBe(200)
    expect(await hacen('B-01', ['us_a_lector'])).toBe(409)

    // Un motor que espera su desarme le deja horas pendientes al técnico de siempre.
    await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)
    const otId = await motorAprobado(p, ['C-01', 'C-02', 'B-01', 'A-01'])
    const tareas = await tareasDe(p, otId)
    expect(tareas.filter((t) => t.grupo === 'diagnostico').every((t) => t.asignadoId === 'us_a_member')).toBe(true)
    expect(llamada(tareas, 'Cepillado').asignadoId).toBe('us_a_tec2')
    expect(llamada(tareas, 'Rectificado de asientos').asignadoId).toBe('us_a_tec2')
    expect(llamada(tareas, 'Rectificado de cilindros').asignadoId).toBe('us_a_member')
    expect(llamada(tareas, 'Armado').asignadoId).toBeNull()

    // Al reasignar la culata, lo que sigue de la culata en la sección va con ella.
    const r = await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${llamada(tareas, 'Cepillado').id}/asignar`, { usuario: 'us_a_member' })
    expect(r.cuerpo).toMatchObject({ ok: true, tambien: 1 })
    expect(llamada(await tareasDe(p, otId), 'Rectificado de asientos').asignadoId).toBe('us_a_member')

    // La carga: la gente de cada sección es la que hace sus actividades.
    const carga = (await p.pedir('us_a_member', 'GET', '/api/servicio/carga')).cuerpo
    const culatas = carga.secciones.find((s: { nombre: string }) => s.nombre === 'Culatas')
    expect(culatas.gente.map((g: { id: string }) => g.id).sort()).toEqual(['us_a_member', 'us_a_tec2'])
    expect(culatas.ahora).toBeGreaterThan(0)
    expect(carga.secciones.find((s: { nombre: string }) => s.nombre === 'Armado')).toMatchObject({ gente: [], sinAsignar: 1, dias: null })

    // Lo que quedó sin asignar se reparte cuando la actividad tiene especialistas.
    expect(await hacen('A-01', ['us_a_tec2'])).toBe(200)
    const armado = (await p.base.select({ id: shopSections.id }).from(shopSections).where(and(eq(shopSections.tenantId, 'tn_a'), eq(shopSections.name, 'Armado'))))[0]
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/secciones/${armado.id}/repartir`)).cuerpo).toMatchObject({ repartidos: 1 })
    expect(llamada(await tareasDe(p, otId), 'Armado').asignadoId).toBe('us_a_tec2')
  })

  it('las actividades: el administrador las crea con su criterio y su valor; el jefe elige quién las hace', async () => {
    const p = await armarPrueba()
    const [diagnostico] = await p.base.select().from(shopSections).where(and(eq(shopSections.tenantId, 'tn_a'), eq(shopSections.kind, 'diagnosis')))
    const nueva = { nombre: 'Prueba hidráulica de culata grande', seccionId: diagnostico.id, pieza: 'culata', criterio: 'per_cylinder', precio: 12_000, horas: 0.3 }
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/catalogo', nueva)).estado).toBe(403)
    const r = await p.pedir('us_a_admin', 'POST', '/api/servicio/catalogo', nueva)
    expect(r.cuerpo).toMatchObject({ codigo: 'D-05' })
    const creada = await actividad(p.base, 'D-05')
    expect(creada).toMatchObject({ piece: 'culata', criterion: 'per_cylinder', unit: 'cilindro', step: 170, typical: false, price: 12_000 })

    expect((await p.pedir('us_a_admin', 'POST', `/api/servicio/catalogo/${creada.id}`, { criterio: 'per_head', paso: 35, tipico: true })).estado).toBe(200)
    expect(await actividad(p.base, 'D-05')).toMatchObject({ criterion: 'per_head', unit: 'culata', step: 35, typical: true, price: 12_000 })
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/catalogo/${creada.id}`, { precio: 1 })).estado).toBe(403)

    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/catalogo/${creada.id}/especialistas`, { usuarios: ['us_a_member'] })).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/catalogo/${creada.id}/especialistas`, { usuarios: ['us_a_member'] })).estado).toBe(200)
    const catalogo = (await p.pedir('us_a_member', 'GET', '/api/servicio/catalogo')).cuerpo
    expect(catalogo.trabajos.find((t: { codigo: string }) => t.codigo === 'D-05')).toMatchObject({ especialistas: ['us_a_member'], precio: null, criterio: 'per_head' })

    // Con la OT de 6 cilindros, «agregar trabajo» cuenta solo.
    const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', recepcion)).cuerpo
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/ot/${otId}/tareas`, { trabajoId: (await actividad(p.base, 'B-01')).id })
    expect((await tareasDe(p, otId)).map((t) => t.nombre)).toContain('Rectificado de cilindros (6 cilindros)')
  })

  it('aislamiento: nada del reparto cruza de una rectificadora a otra, y cada intento queda anotado', async () => {
    const p = await armarPrueba()
    const otId = await motorAprobado(p, ['B-01'])
    const tarea = llamada(await tareasDe(p, otId), 'Rectificado de cilindros')
    const deA = await actividad(p.base, 'B-01')
    const deB = await actividad(p.base, 'B-01', 'tn_b')
    const [seccionA] = await p.base.select().from(shopSections).where(eq(shopSections.tenantId, 'tn_a'))

    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/catalogo/${deA.id}/especialistas`, { usuarios: ['us_b_member'] })).estado).toBe(404)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/catalogo/${deA.id}/especialistas`, { usuarios: ['us_b_member'] })).estado).toBe(404)
    expect((await p.pedir('us_b_member', 'POST', `/api/servicio/tareas/${tarea.id}/detener`, { motivo: 'parts' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/tareas/${tarea.id}/adelantar`)).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/tareas/${tarea.id}/reanudar`)).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/secciones/${seccionA.id}/repartir`)).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/catalogo/${deA.id}`, { precio: 1 })).estado).toBe(404)
    // Una cotización de A con una actividad de B tampoco.
    const ajena = { tipo: 'trabajo', trabajoId: deB.id, seccionId: null, codigo: deB.code, descripcion: deB.name, cantidad: 6, precio: 1, horas: 1 }
    expect((await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', motor: 'Cummins ISX15', lineas: [ajena] })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(8)

    // B no ve la carga, la gente ni las actividades de A.
    const carga = JSON.stringify((await p.pedir('us_b_admin', 'GET', '/api/servicio/carga')).cuerpo)
    expect(carga).not.toContain('us_a_')
    const catalogo = (await p.pedir('us_b_admin', 'GET', '/api/servicio/catalogo')).cuerpo
    expect(catalogo.trabajos.every((t: { id: string }) => t.id.startsWith('srv_b'))).toBe(true)
    expect((await p.pedir('us_b_admin', 'GET', '/api/servicio/taller')).cuerpo.secciones.flatMap((s: { tareas: unknown[] }) => s.tareas)).toHaveLength(0)
  })
})
