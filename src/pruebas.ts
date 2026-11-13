// Para las pruebas: una base PGlite en memoria con dos clientes (A y B), el equipo (con y sin permisos) y la app
// armada con la identidad por cookie y una hora fija.
import { eq } from 'drizzle-orm'
import { abrirBase } from './base'
import { identidadPorCookie } from './modulos/acceso/identidad'
import { TODOS_LOS_PERMISOS } from './modulos/acceso/permisos'
import { events } from './modulos/eventos/tablas'
import type { TipoEvento } from './modulos/eventos/tipos'
import { customers } from './modulos/comercial/tablas'
import { tallerInicial } from './modulos/taller/comun'
import { services, shopSections } from './modulos/taller/tablas'
import { tenants } from './modulos/tenants/tablas'
import { platformAdmins, users } from './modulos/usuarios/tablas'
import { crearApp } from './servidor'

export const AHORA = new Date('2026-11-11T15:00:00Z')

export async function armarPrueba(ahora = AHORA) {
  const base = await abrirBase()
  const antes = new Date(ahora.getTime() - 100 * 86_400_000)
  await base.insert(platformAdmins).values([
    { id: 'adm_todo', name: 'Ana Todo', email: 'ana@plataforma.test', permissions: TODOS_LOS_PERMISOS },
    { id: 'adm_sin', name: 'Beto Sin', email: 'beto@plataforma.test', permissions: [] },
  ])
  const cliente = (id: string, name: string) => ({ id, name, slug: id, region: 'sa-1' as const, status: 'active' as const, plan: 'pro' as const, billingEmail: `pagos@${id}.test`, billingStatus: 'paid' as const, mrr: 89_000, featureFlags: { purchasing: true, supplies: true, machines: true }, createdAt: antes })
  await base.insert(tenants).values([cliente('tn_a', 'Cliente A'), cliente('tn_b', 'Cliente B')])
  const persona = (id: string, tenantId: string, role: 'admin' | 'technician') => ({ id, tenantId, name: id, email: `${id}@${tenantId}.test`, role, status: 'active' as const, createdAt: antes })
  await base.insert(users).values([persona('us_a_admin', 'tn_a', 'admin'), persona('us_a_member', 'tn_a', 'technician'), persona('us_b_admin', 'tn_b', 'admin'), persona('us_b_member', 'tn_b', 'technician')])
  // Cada cliente con su taller inicial y un cliente propio. Ids fijos para poder nombrarlos en las pruebas.
  for (const tenantId of ['tn_a', 'tn_b']) {
    let n = 0
    const { secciones, trabajos } = tallerInicial(tenantId, (prefijo) => `${prefijo}_${tenantId.slice(3)}${n++}`)
    await base.insert(shopSections).values(secciones)
    await base.insert(services).values(trabajos)
    await base.insert(customers).values({ id: `cl_${tenantId.slice(3)}`, tenantId, name: `Transportes ${tenantId}` })
  }
  await base.insert(users).values([
    { ...persona('us_a_jefe', 'tn_a', 'technician'), role: 'planner' as const },
    { ...persona('us_a_lector', 'tn_a', 'technician'), role: 'viewer' as const },
  ])
  const app = crearApp(base, identidadPorCookie(base), () => ahora)

  /** Un pedido como `quien` (id de la cookie `como`). `cookies` agrega otras (la de impersonación). */
  async function pedir(quien: string | null, metodo: string, ruta: string, datos?: unknown, cookies: Record<string, string> = {}, encabezados: Record<string, string> = {}) {
    const galletas = Object.entries({ ...(quien ? { como: quien } : {}), ...cookies }).map(([k, v]) => `${k}=${v}`).join('; ')
    const r = await app.request(ruta, {
      method: metodo,
      headers: { cookie: galletas, 'x-forwarded-for': '203.0.113.9', 'user-agent': 'prueba/1.0', ...(datos === undefined ? {} : { 'content-type': 'application/json' }), ...encabezados },
      body: datos === undefined ? undefined : JSON.stringify(datos),
    })
    return { estado: r.status, cuerpo: (await r.json()) as any, encabezados: r.headers }
  }

  const eventos = (tipo: TipoEvento) => base.select().from(events).where(eq(events.eventType, tipo))
  return { base, app, pedir, eventos, ahora }
}
