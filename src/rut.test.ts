import { describe, expect, it } from 'vitest'
import { digitoVerificador, formatoRut, rutValido } from './rut'

describe('el RUT', () => {
  it('se revisa con su dígito verificador, con o sin puntos y guion', () => {
    expect(digitoVerificador(76_412_893)).toBe('1')
    expect(digitoVerificador(12_345_678)).toBe('5')
    // Los dos casos de borde del módulo 11: resto 11 es 0 y resto 10 es K.
    expect(digitoVerificador(11_111_112)).toBe('K')
    expect(digitoVerificador(11_111_117)).toBe('0')
    expect(rutValido('76.412.893-1')).toBe(true)
    expect(rutValido('764128931')).toBe(true)
    expect(rutValido('11.111.112-k')).toBe(true)
    expect(rutValido('76.412.893-5')).toBe(false)
    expect(rutValido('1-9')).toBe(false)
    expect(rutValido('no es un rut')).toBe(false)
  })

  it('se escribe con puntos y guion', () => {
    expect(formatoRut('764128931')).toBe('76.412.893-1')
    expect(formatoRut('11111112k')).toBe('11.111.112-K')
    expect(formatoRut('9.876.543-3')).toBe('9.876.543-3')
  })
})
