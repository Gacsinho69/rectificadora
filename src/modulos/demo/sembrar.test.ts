import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { abrirBase } from '../../base'
import { AHORA } from '../../pruebas'
import { crearApp } from '../../servidor'
import { identidadPorCookie } from '../acceso/identidad'
import { platformAdmins, users } from '../usuarios/tablas'
import { TIPOS_ALERTA } from '../alertas/reglas'
import { filtrarTenants, filtrosTenants } from '../plataforma/listado'
import { panorama, todasLasAlertas } from '../plataforma/panorama'
import { sembrarDemo } from './sembrar'

describe('la demostración', () => {
  it('siembra una vez y trae cada tipo de alerta y cada estado de salud', async () => {
    const base = await abrirBase()
    expect(await sembrarDemo(base, AHORA)).toBe(true)
    expect(await sembrarDemo(base, AHORA)).toBe(false)
    const lista = await panorama(base, AHORA)
    expect(lista.length).toBeGreaterThanOrEqual(30)
    const alertas = await todasLasAlertas(base, AHORA, lista)
    expect(new Set(alertas.map((a) => a.tipo))).toEqual(new Set(Object.keys(TIPOS_ALERTA)))
    expect(new Set(lista.map((t) => t.salud?.estado).filter(Boolean))).toEqual(new Set(['healthy', 'warning', 'at_risk', 'critical']))

    // Los filtros de la lista sobre datos de verdad.
    const sinActividad = filtrarTenants(lista, filtrosTenants.parse({ actividad: 'sin30' }))
    expect(sinActividad.filas.every((t) => t.diasSinLogin === null || t.diasSinLogin >= 30)).toBe(true)
    const porMrr = filtrarTenants(lista, filtrosTenants.parse({ orden: 'mrr', dir: 'desc', estado: 'active,past_due' }))
    expect(porMrr.filas[0].plan).toBe('enterprise')
    expect(porMrr.filas.every((t) => t.estado === 'active' || t.estado === 'past_due')).toBe(true)
  })

  it('las rutas de la consola y del panel responden con la demostración cargada', async () => {
    const base = await abrirBase()
    await sembrarDemo(base, AHORA)
    const app = crearApp(base, identidadPorCookie(base), () => AHORA)
    const [admin] = await base.select().from(platformAdmins).where(eq(platformAdmins.name, 'Valentina Rojas'))
    const pedir = async (quien: string, ruta: string) => {
      const r = await app.request(ruta, { headers: { cookie: `como=${quien}` } })
      return { estado: r.status, cuerpo: (await r.json()) as any }
    }
    for (const ruta of ['/api/plataforma/resumen', '/api/plataforma/alertas', '/api/plataforma/actividad?dias=14', '/api/plataforma/eventos?categoria=soporte', '/api/plataforma/usuarios?q=gonzalez'])
      expect((await pedir(admin.id, ruta)).estado, ruta).toBe(200)
    expect((await pedir(admin.id, '/api/plataforma/usuarios?q=gonzalez')).cuerpo.length).toBeGreaterThan(0)
    const { cuerpo } = await pedir(admin.id, '/api/plataforma/tenants?q=biobio')
    expect(cuerpo.filas.map((t: { nombre: string }) => t.nombre)).toEqual(['Rectificadora Biobío'])
    const id = cuerpo.filas[0].id
    for (const pestana of ['', '/usuarios', '/actividad', '/uso', '/facturacion', '/integraciones', '/seguridad', '/eventos'])
      expect((await pedir(admin.id, `/api/plataforma/tenants/${id}${pestana}`)).estado, pestana).toBe(200)
    const [duenio] = await base.select().from(users).where(and(eq(users.tenantId, id), eq(users.role, 'admin'), eq(users.status, 'active'))).limit(1)
    for (const ruta of ['/api/organizacion/resumen', '/api/organizacion/usuarios', '/api/organizacion/uso', '/api/organizacion/facturacion', '/api/organizacion/integraciones', '/api/organizacion/seguridad', '/api/organizacion/eventos'])
      expect((await pedir(duenio.id, ruta)).estado, ruta).toBe(200)
  })
})
