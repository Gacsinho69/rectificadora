import { describe, expect, it } from 'vitest'
import { cantidad, plata, unidadPara } from './formato'

describe('cómo se escriben cantidades y montos', () => {
  it('la unidad va en plural cuando corresponde', () => {
    expect(cantidad(1, 'litro')).toBe('1 litro')
    expect(cantidad(27, 'litro')).toBe('27 litros')
    expect(cantidad(2, 'unidad')).toBe('2 unidades')
    expect(cantidad(0.5, 'litro')).toBe('0,5 litros')
    expect(cantidad(-1, 'juego')).toBe('-1 juego')
    // Abreviada o de varias palabras, como está.
    expect(cantidad(3, 'kg')).toBe('3 kg')
    expect(cantidad(3, 'caja de 12')).toBe('3 caja de 12')
    expect(unidadPara(4, 'tarro')).toBe('tarros')
  })

  it('lo negativo lleva el signo antes del peso', () => {
    expect(plata(-57_800)).toBe('-$57.800')
    expect(plata(57_800)).toBe('$57.800')
  })
})
