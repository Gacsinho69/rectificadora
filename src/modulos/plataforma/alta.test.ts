import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { armarPrueba } from '../../pruebas'
import { tenants } from '../tenants/tablas'
import { users } from '../usuarios/tablas'

type Prueba = Awaited<ReturnType<typeof armarPrueba>>
type Seccion = { nombre: string }
type Actividad = { id: string; codigo: string }

const motivo = 'Contrato firmado con ventas'
const alta = (extra: object = {}) => ({
  nombre: 'Rectificadora Ñuble',
  subdominio: 'nuble',
  region: 'sa-1',
  plan: 'starter',
  estado: 'trial',
  diasPrueba: 14,
  correoFacturacion: 'pagos@nuble.test',
  plantilla: 'culatas',
  administrador: { nombre: 'Rosa Muñoz', correo: ' Rosa@Nuble.test ' },
  motivo,
  ...extra,
})
const darDeAlta = (p: Prueba, extra: object = {}) => p.pedir('adm_todo', 'POST', '/api/plataforma/tenants', alta(extra))
const catalogoDe = async (p: Prueba, quien: string) => (await p.pedir(quien, 'GET', '/api/servicio/catalogo')).cuerpo as { secciones: Seccion[]; trabajos: Actividad[] }

describe('el alta de una rectificadora desde la consola', () => {
  it('nace con el taller de su plantilla, su administrador y sus eventos con el después y el motivo', async () => {
    const p = await armarPrueba()
    const r = await darDeAlta(p)
    expect(r.estado).toBe(200)
    const { id, administradorId } = r.cuerpo
    const [t] = await p.base.select().from(tenants).where(eq(tenants.id, id))
    expect(t).toMatchObject({ name: 'Rectificadora Ñuble', slug: 'nuble', status: 'trial', plan: 'starter', mrr: 0, billingStatus: 'none', nextBillingAt: null, featureFlags: { client_portal: true }, billingEmail: 'pagos@nuble.test' })
    expect(t.trialEndsAt?.toISOString()).toBe(new Date(p.ahora.getTime() + 14 * 86_400_000).toISOString())
    const [creado] = await p.eventos('tenant.created')
    expect(creado).toMatchObject({ tenantId: id, actorId: 'adm_todo', actorType: 'platform_admin', targetId: id })
    expect(creado.metadata).toMatchObject({ antes: null, despues: { subdominio: 'nuble', plan: 'starter', estado: 'trial', mrr: 0, plantilla: 'culatas' }, motivo })
    const [admin] = await p.eventos('user.created')
    expect(admin).toMatchObject({ tenantId: id, userId: administradorId, actorId: 'adm_todo' })
    expect(admin.metadata).toMatchObject({ rol: 'admin', correo: 'rosa@nuble.test', motivo })

    // Su administrador entra a su sistema: un taller de culatas, sin block ni cigüeñal.
    const catalogo = await catalogoDe(p, administradorId)
    expect(catalogo.secciones.map((s) => s.nombre)).toEqual(['Recepción y diagnóstico', 'Culatas', 'Servicios de terceros'])
    expect(catalogo.trabajos.map((x) => x.codigo).sort()).toEqual(['C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06', 'D-03', 'D-04', 'T-01'])
    expect((await p.pedir(administradorId, 'GET', '/api/organizacion/usuarios')).cuerpo).toMatchObject([{ id: administradorId, correo: 'rosa@nuble.test', rol: 'admin', estado: 'active' }])

    // Recibe su primera culata: la OT-0001, con su diagnóstico de fisuras e hidráulica.
    const cliente = (await p.pedir(administradorId, 'POST', '/api/servicio/clientes', { nombre: 'Transportes Chillán' })).cuerpo
    const ot = (await p.pedir(administradorId, 'POST', '/api/servicio/ot', { clienteId: cliente.id, motor: 'Toyota 1KD-FTV', piezas: ['culata'], cilindros: 4 })).cuerpo
    expect(ot.numero).toBe(1)
    const tareas = (await p.pedir(administradorId, 'GET', `/api/servicio/ot/${ot.id}`)).cuerpo.tareas as { nombre: string }[]
    expect(tareas.map((x) => x.nombre)).toEqual(['Prueba de fisuras (magnaflux)', 'Prueba hidráulica de culata (4 cilindros)'])
    // La consola ve su ficha como la de cualquier cliente.
    expect((await p.pedir('adm_todo', 'GET', `/api/plataforma/tenants/${id}`)).estado).toBe(200)
  })

  it('activa desde ya: paga el precio de lista o el negociado, con su próximo cobro', async () => {
    const p = await armarPrueba()
    const grande = (await darDeAlta(p, { subdominio: 'nuble-sur', estado: 'active', plan: 'enterprise', mrr: 300_000, plantilla: 'completa' })).cuerpo
    const [t] = await p.base.select().from(tenants).where(eq(tenants.id, grande.id))
    expect(t).toMatchObject({ status: 'active', mrr: 300_000, billingStatus: 'paid', trialEndsAt: null, featureFlags: { public_api: true, inventory: true } })
    expect(t.nextBillingAt?.toISOString()).toBe('2026-12-11T15:00:00.000Z')
    const completa = await catalogoDe(p, grande.administradorId)
    expect([completa.secciones.length, completa.trabajos.length]).toEqual([7, 29])

    const block = (await darDeAlta(p, { subdominio: 'nuble-norte', estado: 'active', plan: 'pro', plantilla: 'block' })).cuerpo
    const [b] = await p.base.select().from(tenants).where(eq(tenants.id, block.id))
    expect(b.mrr).toBe(89_000)
    expect((await catalogoDe(p, block.administradorId)).secciones.map((s) => s.nombre)).toEqual(['Recepción y diagnóstico', 'Block', 'Cigüeñal y bielas', 'Armado', 'Control de calidad', 'Servicios de terceros'])
  })

  it('sin permiso no se crea; el subdominio ocupado, reservado o mal escrito y el motivo corto se rechazan', async () => {
    const p = await armarPrueba()
    expect((await p.pedir('adm_sin', 'POST', '/api/plataforma/tenants', alta())).estado).toBe(403)
    const [negado] = await p.eventos('security.permission_denied')
    expect(negado).toMatchObject({ tenantId: null, actorId: 'adm_sin' })
    expect(negado.metadata).toMatchObject({ permiso: 'tenants.create' })
    // Alguien de una rectificadora no llega a la consola: queda como intento de acceso cruzado.
    expect((await p.pedir('us_a_admin', 'POST', '/api/plataforma/tenants', alta())).estado).toBe(403)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(1)

    expect((await darDeAlta(p)).estado).toBe(200)
    const repetido = await darDeAlta(p, { nombre: 'Otra Rectificadora', subdominio: ' NUBLE ' })
    expect(repetido.estado).toBe(409)
    expect(repetido.cuerpo.error).toContain('Rectificadora Ñuble')
    expect((await darDeAlta(p, { subdominio: 'admin' })).cuerpo.error).toContain('es de la plataforma')
    expect((await darDeAlta(p, { subdominio: 'ñuble!' })).estado).toBe(400)
    expect((await darDeAlta(p, { subdominio: 'nu--ble' })).estado).toBe(400)
    expect((await darDeAlta(p, { subdominio: 'otra', motivo: 'corto' })).estado).toBe(400)
    expect((await darDeAlta(p, { subdominio: 'otra', plantilla: 'bombas' })).estado).toBe(400)
    expect((await darDeAlta(p, { subdominio: 'otra', administrador: { nombre: 'Rosa', correo: 'no-es-correo' } })).cuerpo.error).toBe('El correo no es válido.')
    expect(await p.base.select().from(tenants)).toHaveLength(3)
  })
})

describe('sumar gente a una rectificadora', () => {
  it('su administrador agrega hasta el límite de su plan, y el técnico nuevo puede ser especialista', async () => {
    const p = await armarPrueba()
    const { id, administradorId } = (await darDeAlta(p, { plan: 'free', plantilla: 'completa' })).cuerpo
    const agregar = (persona: object, quien = administradorId) => p.pedir(quien, 'POST', '/api/organizacion/usuarios', persona)
    expect((await p.pedir(administradorId, 'GET', '/api/organizacion/usuarios/cupo')).cuerpo).toEqual({ usados: 1, limite: 3, plan: 'Free' })

    const tecnico = (await agregar({ nombre: 'Pedro Gallardo', correo: 'pedro@nuble.test', rol: 'technician' })).cuerpo.id
    // El técnico no agrega a nadie: el panel es del administrador.
    expect((await agregar({ nombre: 'Otro Más', correo: 'otro@nuble.test', rol: 'technician' }, tecnico)).estado).toBe(403)
    // El mismo correo no entra dos veces, aunque cambien las mayúsculas.
    const repetido = await agregar({ nombre: 'Pedro G.', correo: 'PEDRO@nuble.test', rol: 'viewer' })
    expect(repetido.estado).toBe(409)
    expect(repetido.cuerpo.error).toContain('Pedro Gallardo')
    expect((await agregar({ nombre: 'Luis Carrasco', correo: 'luis@nuble.test', rol: 'planner' })).estado).toBe(200)
    const lleno = await agregar({ nombre: 'Ana Vergara', correo: 'ana@nuble.test', rol: 'technician' })
    expect(lleno.estado).toBe(409)
    expect(lleno.cuerpo.error).toContain('límite del plan Free: 3 usuarios')

    // La plataforma amplía el límite y ya cabe.
    await p.pedir('adm_todo', 'POST', `/api/plataforma/tenants/${id}/limites`, { ajustes: { users: 4 }, motivo })
    expect((await agregar({ nombre: 'Ana Vergara', correo: 'ana@nuble.test', rol: 'technician' })).estado).toBe(200)
    const creados = (await p.eventos('user.created')).filter((e) => e.tenantId === id)
    expect(creados).toHaveLength(4)
    expect(creados.find((e) => (e.metadata as { correo?: string }).correo === 'pedro@nuble.test')).toMatchObject({ actorId: administradorId, actorType: 'user', userId: tecnico })

    // Se le da el cepillado de culatas y entra a su tablero.
    const cepillado = (await catalogoDe(p, administradorId)).trabajos.find((x) => x.codigo === 'C-01')!
    expect((await p.pedir(administradorId, 'POST', `/api/servicio/catalogo/${cepillado.id}/especialistas`, { usuarios: [tecnico] })).estado).toBe(200)
    expect((await p.pedir(tecnico, 'GET', '/api/servicio/taller')).estado).toBe(200)
  })

  it('aislamiento: la persona va a la organización de la sesión; nada del pedido la cambia', async () => {
    const p = await armarPrueba()
    const r = await p.pedir('us_b_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Intruso Pérez', correo: 'intruso@b.test', rol: 'admin', tenantId: 'tn_a' })
    expect(r.estado).toBe(200)
    const [nuevo] = await p.base.select().from(users).where(eq(users.id, r.cuerpo.id))
    expect(nuevo.tenantId).toBe('tn_b')
    // Elegir otra organización por encabezado se rechaza y queda anotado.
    const cruzado = await p.pedir('us_b_admin', 'POST', '/api/organizacion/usuarios', { nombre: 'Intruso Dos', correo: 'dos@b.test', rol: 'admin' }, {}, { 'x-tenant-id': 'tn_a' })
    expect(cruzado.estado).toBe(403)
    expect(await p.eventos('security.cross_tenant_access_attempt')).toHaveLength(1)
    expect(await p.base.select().from(users).where(eq(users.tenantId, 'tn_a'))).toHaveLength(4)
    // El mismo correo puede estar en dos organizaciones: cada una tiene su gente.
    const chofer = { nombre: 'Diego Silva', correo: 'diego.silva@correo.test', rol: 'technician' }
    expect((await p.pedir('us_a_admin', 'POST', '/api/organizacion/usuarios', chofer)).estado).toBe(200)
    expect((await p.pedir('us_b_admin', 'POST', '/api/organizacion/usuarios', chofer)).estado).toBe(200)
  })

  it('el equipo agrega a alguien a un cliente con permiso y motivo, y solo a ese cliente', async () => {
    const p = await armarPrueba()
    const persona = { nombre: 'Marta Soto', correo: 'marta@a.test', rol: 'admin', motivo }
    expect((await p.pedir('adm_sin', 'POST', '/api/plataforma/tenants/tn_a/usuarios', persona)).estado).toBe(403)
    expect((await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/usuarios', { ...persona, motivo: 'corto' })).estado).toBe(400)
    const r = await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_a/usuarios', persona)
    expect(r.estado).toBe(200)
    const [u] = await p.base.select().from(users).where(eq(users.id, r.cuerpo.id))
    expect(u).toMatchObject({ tenantId: 'tn_a', role: 'admin', status: 'active', email: 'marta@a.test' })
    const [e] = await p.eventos('user.created')
    expect(e).toMatchObject({ tenantId: 'tn_a', actorId: 'adm_todo', actorType: 'platform_admin', userId: u.id })
    expect(e.metadata).toMatchObject({ motivo })
    // A un cliente cancelado ya no se le agrega gente; uno que no existe, no existe.
    await p.base.update(tenants).set({ status: 'cancelled' }).where(eq(tenants.id, 'tn_b'))
    expect((await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_b/usuarios', persona)).estado).toBe(409)
    expect((await p.pedir('adm_todo', 'POST', '/api/plataforma/tenants/tn_x/usuarios', persona)).estado).toBe(404)
  })
})
