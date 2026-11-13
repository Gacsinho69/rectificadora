import { describe, expect, it } from 'vitest'
import { PLANTILLAS_TALLER, TRABAJOS_INICIALES } from '../taller/reglas'
import { faltaDelSubdominio, subdominioDe } from './reglas'

describe('el subdominio de una rectificadora', () => {
  it('se propone desde el nombre, sin tildes ni la palabra «rectificadora»', () => {
    expect(subdominioDe('Rectificadora Ñuble Sur')).toBe('nuble-sur')
    expect(subdominioDe('Rectificadora Los Andes')).toBe('los-andes')
    expect(subdominioDe('  Motores & Culatas Talca ')).toBe('motores-culatas-talca')
  })

  it('se revisa: largo, letras, guiones y los que son de la plataforma', () => {
    expect(faltaDelSubdominio('nuble')).toBeNull()
    expect(faltaDelSubdominio('ab')).toContain('de 3 a 40')
    expect(faltaDelSubdominio('ñuble')).toContain('sin tildes')
    expect(faltaDelSubdominio('-nuble')).toContain('guion')
    expect(faltaDelSubdominio('nu--ble')).toContain('guion')
    expect(faltaDelSubdominio('admin')).toContain('es de la plataforma')
  })
})

describe('las plantillas de taller', () => {
  it('cada una trae actividades que existen, con su sección, y ninguna sección queda vacía', () => {
    for (const [clave, p] of Object.entries(PLANTILLAS_TALLER)) {
      const secciones: readonly string[] = p.secciones
      expect(secciones, clave).toContain('diagnostico')
      for (const codigo of p.codigos) {
        const t = TRABAJOS_INICIALES.find((x) => x.codigo === codigo)
        expect(t, `${clave}: ${codigo}`).toBeDefined()
        expect(secciones, `${clave}: ${codigo}`).toContain(t!.seccion)
      }
      for (const s of secciones) expect(p.codigos.some((c) => TRABAJOS_INICIALES.find((x) => x.codigo === c)?.seccion === s), `${clave}: ${s}`).toBe(true)
    }
  })
})
