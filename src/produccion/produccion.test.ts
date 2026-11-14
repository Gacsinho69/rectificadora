import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { abrirBase } from '../base'
import { agregarAlEquipo, claveDePasoDelEquipo } from '../modulos/acceso/equipo'
import { events } from '../modulos/eventos/tablas'
import { armarProduccion } from './app'
import { baseSinClave, leerConfiguracion } from './configuracion'

const DOMINIO = 'rectificadora.test'
const EN = `https://${DOMINIO}`

/** Unas pantallas compiladas de mentira: la página y un archivo con huella. */
function pantallas() {
  const carpeta = mkdtempSync(join(tmpdir(), 'pantallas-'))
  mkdirSync(join(carpeta, 'assets'))
  writeFileSync(join(carpeta, 'index.html'), '<!doctype html><title>Rectificadora</title><div id="raiz"></div>')
  writeFileSync(join(carpeta, 'assets', 'index-a1b2c3.js'), 'console.log("hola")')
  return carpeta
}

async function armar() {
  const base = await abrirBase()
  const lineas: string[] = []
  const app = armarProduccion(base, { dominio: DOMINIO, pantallas: pantallas(), anotar: (l) => lineas.push(l) })
  const pedir = (camino: string, init: RequestInit = {}) => app.request(camino.startsWith('http') ? camino : `${EN}${camino}`, init)
  const enviar = (camino: string, cuerpo: unknown, encabezados: Record<string, string> = {}) =>
    pedir(camino, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', ...encabezados }, body: JSON.stringify(cuerpo) })
  return { base, app, lineas, pedir, enviar }
}

const cookieDe = (r: Response) => r.headers.get('set-cookie')?.split(';')[0] ?? ''

describe('la configuración de producción', () => {
  it('no arranca sin la base ni el dominio, y dice cómo se escriben', () => {
    expect(() => leerConfiguracion({})).toThrow(/DATABASE_URL[\s\S]*DOMINIO_PLATAFORMA/)
    expect(() => leerConfiguracion({ DATABASE_URL: 'mysql://x', DOMINIO_PLATAFORMA: 'https://rectificadora.cl/' })).toThrow(/postgres:\/\/[\s\S]*sin https/)
    expect(() => leerConfiguracion({ DATABASE_URL: 'postgres://a@b/c', DOMINIO_PLATAFORMA: 'rectificadora.cl', PORT: 'ochenta' })).toThrow(/PORT/)
    expect(leerConfiguracion({ DATABASE_URL: 'postgres://a@b/c', DOMINIO_PLATAFORMA: ' Rectificadora.CL ' })).toEqual({ baseDeDatos: 'postgres://a@b/c', dominio: 'rectificadora.cl', puerto: 3000, demostracion: false })
    expect(leerConfiguracion({ DATABASE_URL: 'postgresql://a@b/c', DOMINIO_PLATAFORMA: 'localhost', PORT: '8080', DEMOSTRACION: 'sí' })).toMatchObject({ puerto: 8080, demostracion: true })
    // En el registro, la base sin su clave.
    expect(baseSinClave('postgres://app:secreta@db.servidor.cl:5432/rectificadora?sslmode=require')).toBe('postgres://app@db.servidor.cl:5432/rectificadora')
  })
})

describe('el servidor de producción', () => {
  it('muestra las pantallas: la página siempre fresca, los archivos con huella guardados un año, y con sus encabezados de seguridad', async () => {
    const { pedir, lineas } = await armar()
    const pagina = await pedir('/c/los-andes/ot/123')
    expect(pagina.status).toBe(200)
    expect(await pagina.text()).toContain('<div id="raiz">')
    expect(pagina.headers.get('cache-control')).toBe('no-cache')
    const politica = pagina.headers.get('content-security-policy') ?? ''
    expect(politica).toContain("script-src 'self'")
    expect(politica).toContain("frame-ancestors 'none'")
    expect(pagina.headers.get('x-content-type-options')).toBe('nosniff')
    expect(pagina.headers.get('strict-transport-security')).toContain('max-age=')

    const archivo = await pedir('/assets/index-a1b2c3.js')
    expect(archivo.status).toBe(200)
    expect(archivo.headers.get('cache-control')).toContain('immutable')
    expect((await pedir('/assets/no-existe.js')).status).toBe(404)
    expect((await pedir('/favicon.ico')).status).toBe(404)
    expect(await (await pedir('/robots.txt')).text()).toContain('Disallow: /')
    // Lo que no es de la API no se confunde con ella.
    const nada = await pedir('/api/no-existe')
    expect(nada.status).toBe(404)
    expect(await nada.json()).toEqual({ error: 'No existe esa dirección.' })
    expect(lineas.some((l) => l.includes('/c/los-andes/ot/123'))).toBe(true)
  })

  it('la salud responde con la base y no se anota', async () => {
    const { pedir, lineas } = await armar()
    const salud = await pedir('/api/salud')
    expect(salud.status).toBe(200)
    expect(await salud.json()).toEqual({ ok: true })
    expect(lineas.some((l) => l.includes('/api/salud'))).toBe(false)
  })

  it('no trae «Entrar como»: ni sus direcciones ni su cookie sirven', async () => {
    const { base, pedir, enviar } = await armar()
    const { id } = await agregarAlEquipo(base, { correo: 'ana@plataforma.test', nombre: 'Ana' })
    expect((await pedir('/api/desarrollo/personas')).status).toBe(404)
    expect((await enviar('/api/desarrollo/entrar', { id })).status).toBe(404)
    const yo = await pedir('/api/yo', { headers: { cookie: `como=${id}` } })
    expect(await yo.json()).toEqual({ actor: null, impersonacion: null })
  })

  it('el equipo nace desde la consola de comandos: entra con su clave de paso por https, y una clave nueva cierra sus sesiones', async () => {
    const { base, pedir, enviar } = await armar()
    const { id, clave } = await agregarAlEquipo(base, { correo: ' Ana@Plataforma.test ', nombre: 'Ana Pérez' })
    expect(clave).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
    await expect(agregarAlEquipo(base, { correo: 'ana@plataforma.test', nombre: 'Otra' })).rejects.toThrow('ya es del equipo')
    await expect(agregarAlEquipo(base, { correo: 'no es correo', nombre: 'Otra' })).rejects.toThrow('no parece un correo')
    const [evento] = await base.select().from(events).where(and(eq(events.eventType, 'platform_admin.created'), eq(events.targetId, id)))
    expect(evento).toMatchObject({ actorType: 'system', tenantId: null, metadata: { correo: 'ana@plataforma.test', via: 'consola de comandos del servidor' } })

    const entrada = await enviar('/api/entrar', { correo: 'ana@plataforma.test', clave, portal: 'plataforma' })
    expect(entrada.status).toBe(200)
    expect(await entrada.json()).toEqual({ ok: true, destino: '/plataforma' })
    // Detrás del balanceador la conexión de adentro es http, pero la cookie sale segura igual.
    expect(entrada.headers.get('set-cookie')).toMatch(/HttpOnly.*Secure|Secure.*HttpOnly/)
    const sesion = cookieDe(entrada)
    expect((await (await pedir('/api/yo', { headers: { cookie: sesion } })).json()).actor).toMatchObject({ tipo: 'plataforma', id })

    const nueva = await claveDePasoDelEquipo(base, 'ana@plataforma.test')
    expect(nueva.clave).not.toBe(clave)
    expect((await (await pedir('/api/yo', { headers: { cookie: sesion } })).json()).actor).toBeNull()
    expect((await enviar('/api/entrar', { correo: 'ana@plataforma.test', clave, portal: 'plataforma' })).status).toBe(401)
    expect((await enviar('/api/entrar', { correo: 'ana@plataforma.test', clave: nueva.clave, portal: 'plataforma' })).status).toBe(200)
    await expect(claveDePasoDelEquipo(base, 'nadie@plataforma.test')).rejects.toThrow('no es del equipo')
  })

  it('rechaza lo que llega desde otra página (CSRF) y lo demasiado grande', async () => {
    const { enviar } = await armar()
    const datos = { correo: 'ana@plataforma.test', clave: 'algo' }
    expect((await enviar('/api/entrar', datos, { origin: 'https://otra-pagina.cl' })).status).toBe(403)
    expect((await enviar('/api/entrar', datos, { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await enviar('/api/entrar', datos, { origin: 'null' })).status).toBe(403)
    // Desde las pantallas del mismo sitio pasa (y responde lo de siempre: la clave no calza).
    expect((await enviar('/api/entrar', datos, { origin: EN, 'sec-fetch-site': 'same-origin' })).status).toBe(401)
    const grande = await enviar('/api/entrar', { ...datos, relleno: 'x'.repeat(1_100_000) })
    expect(grande.status).toBe(413)
  })

  it('el subdominio de cada rectificadora lleva a su sistema; el de la consola, a la consola', async () => {
    const { pedir } = await armar()
    const destino = async (url: string) => {
      const r = await pedir(url, { headers: { 'x-forwarded-proto': 'https' }, redirect: 'manual' })
      return r.status === 302 ? r.headers.get('location') : r.status
    }
    expect(await destino(`http://nuble.${DOMINIO}/`)).toBe(`${EN}/c/nuble`)
    expect(await destino(`http://nuble.${DOMINIO}/ot/12?pestana=tareas`)).toBe(`${EN}/c/nuble/ot/12?pestana=tareas`)
    expect(await destino(`http://plataforma.${DOMINIO}/`)).toBe(`${EN}/plataforma`)
    expect(await destino(`http://www.${DOMINIO}/entrar`)).toBe(`${EN}/entrar`)
    expect(await destino(`http://a.b.${DOMINIO}/x`)).toBe(`${EN}/`)
    // El dominio mismo, y cualquier otro nombre (el que da el proveedor), atienden directo.
    expect(await destino(`http://${DOMINIO}/c/nuble`)).toBe(200)
    expect(await destino('http://rectificadora.fly.dev/c/nuble')).toBe(200)
  })
})
