import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { services } from '../taller/tablas'
import { mantencionDe } from './reglas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type Maquina = { id: string; nombre: string; trabajos: number; parada: { motivo: string; nota: string | null } | null; mantencion: { ultima: string | null; proxima: string | null; dias: number | null; vencida: boolean } }

const actividad = async (base: Prueba['base'], codigo: string, tenantId = 'tn_a') => (await base.select().from(services).where(and(eq(services.tenantId, tenantId), eq(services.code, codigo))))[0]

/** Un block recibido y aprobado con su lineado de bancada (B-05), listo para hacerse. */
async function blockConLineado(p: Prueba) {
  const { id: otId } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/ot', { clienteId: 'cl_a', motor: 'Cummins ISX15', piezas: ['block'], cilindros: 6, diagnostico: false })).cuerpo
  const b05 = await actividad(p.base, 'B-05')
  const linea = { tipo: 'trabajo', trabajoId: b05.id, seccionId: b05.sectionId, codigo: b05.code, descripcion: b05.name, cantidad: 1, precio: b05.price, horas: b05.stdHours, pieza: b05.piece, criterio: b05.criterion }
  const cot = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/cotizaciones', { clienteId: 'cl_a', otId, motor: 'Cummins ISX15', cilindros: 6, lineas: [linea] })).cuerpo
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/enviar`)
  await p.pedir('us_a_jefe', 'POST', `/api/servicio/cotizaciones/${cot.id}/aceptar`, {})
  const [tarea] = (await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas as { id: string; situacion: string; maquinas: string[] }[]
  return { otId: otId as string, tarea: tarea.id, b05: b05.id }
}

const lista = async (p: Prueba, quien = 'us_a_jefe') => (await p.pedir(quien, 'GET', '/api/servicio/maquinas')).cuerpo as Maquina[]
const tareaDe = async (p: Prueba, otId: string) => ((await p.pedir('us_a_jefe', 'GET', `/api/servicio/ot/${otId}`)).cuerpo.tareas as { id: string; situacion: string; maquinas: string[] }[])[0]

describe('las máquinas', () => {
  it('si la máquina para, sus trabajos esperan solos; al volver a operar, siguen', async () => {
    const p = await armarPrueba()
    const { otId, tarea, b05 } = await blockConLineado(p)
    expect((await p.pedir('us_a_member', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora', actividades: [b05] })).estado).toBe(403)
    const { id } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora de bancada', actividades: [b05], cadaDias: 120 })).cuerpo
    expect((await lista(p))[0]).toMatchObject({ nombre: 'Lineadora de bancada', trabajos: 1, parada: null })

    // El técnico avisa la falla (con lo que le pasa); el de solo lectura no.
    expect((await p.pedir('us_a_lector', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'breakdown', nota: 'No avanza' })).estado).toBe(403)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'breakdown' })).estado).toBe(400)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'breakdown', nota: 'No avanza el carro' })).estado).toBe(200)
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'maintenance' })).estado).toBe(409)
    expect(await tareaDe(p, otId)).toMatchObject({ situacion: 'machine', maquinas: ['Lineadora de bancada (en falla)'] })
    const iniciar = await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${tarea}/iniciar`, {})
    expect(iniciar.estado).toBe(409)
    expect(iniciar.cuerpo.error).toContain('La máquina está detenida: Lineadora de bancada (en falla)')
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/tareas/${tarea}/adelantar`)).estado).toBe(409)
    const tablero = (await p.pedir('us_a_jefe', 'GET', '/api/servicio/taller')).cuerpo.secciones.flatMap((s: { tareas: { id: string; situacion: string }[] }) => s.tareas)
    expect(tablero.find((x: { id: string }) => x.id === tarea).situacion).toBe('machine')

    // Solo el jefe la vuelve a operar; el trabajo queda para hacer.
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/maquinas/${id}/operar`)).estado).toBe(403)
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${id}/operar`)).estado).toBe(200)
    expect((await tareaDe(p, otId)).situacion).toBe('available')
    expect((await p.pedir('us_a_member', 'POST', `/api/servicio/tareas/${tarea}/iniciar`, {})).estado).toBe(200)

    // Fuera de uso, no hace esperar a nadie aunque haya quedado detenida.
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'maintenance' })
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${id}`, { nombre: 'Lineadora de bancada', actividades: [b05], activa: false })
    expect((await tareaDe(p, otId)).maquinas).toEqual([])
  })

  it('la mantención: cuándo toca, la vencida y la que se anota', async () => {
    expect(mantencionDe('2026-10-01', 30, '2026-11-11')).toEqual({ proxima: '2026-10-31', dias: -11, vencida: true })
    expect(mantencionDe('2026-11-01', 30, '2026-11-11')).toEqual({ proxima: '2026-12-01', dias: 20, vencida: false })
    expect(mantencionDe(null, 30, '2026-11-11')).toEqual({ proxima: null, dias: null, vencida: true })
    expect(mantencionDe(null, null, '2026-11-11')).toEqual({ proxima: null, dias: null, vencida: false })

    const p = await armarPrueba()
    const { id } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Rectificadora de cigüeñal', cadaDias: 30, ultima: '2026-10-01' })).cuerpo
    expect((await lista(p))[0].mantencion).toMatchObject({ vencida: true, dias: -11 })
    // Anotada sin parar, o al volver de una parada por mantención: la próxima se cuenta desde hoy.
    expect((await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${id}/mantencion`, { nota: 'Cambio de aceite' })).estado).toBe(200)
    expect((await lista(p))[0].mantencion).toMatchObject({ ultima: '2026-11-11', proxima: '2026-12-11', vencida: false })
    await p.base.execute(`update machines set last_maintenance_at = '2026-09-01' where id = '${id}'`)
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'maintenance' })
    await p.pedir('us_a_jefe', 'POST', `/api/servicio/maquinas/${id}/operar`)
    expect((await lista(p))[0].mantencion.ultima).toBe('2026-11-11')
  })

  it('el alta de un taller trae las máquinas de su plantilla', async () => {
    const p = await armarPrueba()
    const alta = { nombre: 'Culatas del Maule', subdominio: 'maule', region: 'sa-1', plan: 'pro', estado: 'trial', correoFacturacion: 'pagos@maule.test', plantilla: 'culatas', administrador: { nombre: 'Rosa Muñoz', correo: 'rosa@maule.test' }, motivo: 'Contrato firmado con ventas' }
    const { administradorId } = (await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants', alta)).cuerpo
    const suyas = await lista(p, administradorId)
    expect(suyas.map((m) => m.nombre)).toEqual(['Banco de prueba hidráulica', 'Cepilladora', 'Rectificadora de asientos', 'Rectificadora de válvulas'])
    expect(suyas[0].mantencion).toMatchObject({ ultima: '2026-11-11', vencida: false })
  })

  it('aislamiento: otra rectificadora no ve, no detiene ni usa máquinas, secciones o actividades ajenas', async () => {
    const p = await armarPrueba()
    const b05 = await actividad(p.base, 'B-05')
    const { id } = (await p.pedir('us_a_jefe', 'POST', '/api/servicio/maquinas', { nombre: 'Lineadora de bancada', actividades: [b05.id] })).cuerpo
    expect(await lista(p, 'us_b_admin')).toEqual([])
    expect((await p.pedir('us_b_member', 'POST', `/api/servicio/maquinas/${id}/detener`, { motivo: 'breakdown', nota: 'Se quemó' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/maquinas/${id}/operar`)).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', `/api/servicio/maquinas/${id}`, { nombre: 'Mía' })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', '/api/servicio/maquinas', { nombre: 'Con actividad ajena', actividades: [b05.id] })).estado).toBe(404)
    expect((await p.pedir('us_b_admin', 'POST', '/api/servicio/maquinas', { nombre: 'En sección ajena', seccionId: b05.sectionId })).estado).toBe(404)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(5)
    expect((await lista(p))[0]).toMatchObject({ nombre: 'Lineadora de bancada', parada: null })
  })
})
