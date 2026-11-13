import { describe, expect, it } from 'vitest'
import { faltasParaEnviar, totales } from '../comercial/reglas'
import { situacionDe, type TrabajoEnRuta } from '../taller/reglas'
import { claveDeProveedor, estadoDeOc, estadoDeRepuesto, proveedorSchema, trabajoQueLoNecesita } from './reglas'

const en = (id: string, extra: Partial<TrabajoEnRuta> = {}): TrabajoEnRuta => ({ id, pieza: 'block', paso: 140, estado: 'pending', detenido: false, adelantado: false, ...extra })

describe('los repuestos en el taller', () => {
  it('lo que espera repuestos no se puede empezar; se dice antes que la ruta, después de lo detenido', () => {
    expect(situacionDe(en('b1', { faltanRepuestos: 1 }), [])).toBe('parts')
    // Le falta el pistón y además espera el cepillado: lo que hay que ir a buscar se dice primero.
    expect(situacionDe(en('b1', { faltanRepuestos: 1 }), [en('b0', { paso: 130 })])).toBe('parts')
    expect(situacionDe(en('b1', { faltanRepuestos: 1, detenido: true }), [])).toBe('held')
    expect(situacionDe(en('b1', { faltanRepuestos: 1, adelantado: true }), [])).toBe('available')
    expect(situacionDe(en('b1', { faltanRepuestos: 1, estado: 'in_progress' }), [])).toBe('in_progress')
    expect(situacionDe(en('b1', { faltanRepuestos: 0 }), [])).toBe('available')
  })

  it('cada repuesto lo espera el trabajo que dice la cotización; si no, el armado; si no hay armado, lo último', () => {
    const t = (id: string, codigo: string, pieza: string, paso: number, diagnostico = false, estado = 'pending') => ({ id, codigo, pieza, paso, diagnostico, estado })
    const ot = [t('d1', 'D-01', 'motor', 10, true, 'done'), t('b1', 'B-01', 'block', 140), t('a1', 'A-01', 'motor', 210), t('q1', 'Q-01', 'motor', 300)]
    expect(trabajoQueLoNecesita(ot, 'B-01')?.id).toBe('b1')
    expect(trabajoQueLoNecesita(ot)?.id).toBe('a1')
    expect(trabajoQueLoNecesita(ot, 'C-06')?.id).toBe('a1')
    expect(trabajoQueLoNecesita([t('c1', 'C-01', 'culata', 120), t('c6', 'C-06', 'culata', 160)])?.id).toBe('c6')
    expect(trabajoQueLoNecesita([])).toBeNull()
  })

  it('lo que trae el cliente no se cobra ni pide precio para enviar', () => {
    const lineas = [
      { tipo: 'trabajo' as const, descripcion: 'Rectificado de cilindros', cantidad: 6, precio: 22_000 },
      { tipo: 'repuesto' as const, compra: 'customer' as const, descripcion: 'Bomba de aceite', cantidad: 1, precio: null },
      { tipo: 'repuesto' as const, compra: 'shop' as const, descripcion: 'Kit de pistones', cantidad: 1, precio: 420_000 },
    ]
    expect(totales(lineas, 0).subtotal).toBe(552_000)
    expect(faltasParaEnviar(lineas)).toEqual([])
    expect(faltasParaEnviar([{ ...lineas[2], precio: null }])[0]).toContain('Kit de pistones')
  })

  it('la orden de compra: por retirar mientras algo siga pedido; recibida cuando llegó todo', () => {
    expect(estadoDeOc([{ estado: 'ordered' }, { estado: 'received' }], false)).toBe('open')
    expect(estadoDeOc([{ estado: 'received' }, { estado: 'received' }], false)).toBe('received')
    expect(estadoDeOc([{ estado: 'received' }, { estado: 'cancelled' }], false)).toBe('received')
    expect(estadoDeOc([{ estado: 'cancelled' }], false)).toBe('cancelled')
    expect(estadoDeOc([{ estado: 'ordered' }], true)).toBe('cancelled')
    expect(estadoDeRepuesto({ compra: 'customer', estado: 'pending' })).toBe('Lo trae el cliente')
    expect(estadoDeRepuesto({ compra: 'shop', estado: 'pending' })).toBe('Por pedir')
  })

  it('el mismo proveedor, aunque se escriba con otras mayúsculas, tildes, espacios o puntos', () => {
    expect(claveDeProveedor(' Repuestos  Diésel Sur S.A. ')).toBe('repuestosdieselsursa')
    expect(claveDeProveedor('REPUESTOS DIESEL SUR SA')).toBe(claveDeProveedor('repuestos diésel sur s.a.'))
    expect(claveDeProveedor('Ñuble Motores')).toBe('nublemotores')
    expect(claveDeProveedor('Repuestos Diesel Norte')).not.toBe(claveDeProveedor('Repuestos Diesel Sur'))
    expect(proveedorSchema.safeParse({ nombre: 'Repuestos Diesel Sur', rut: '76.412.893-1', correo: '' }).success).toBe(true)
    expect(proveedorSchema.safeParse({ nombre: 'Repuestos Diesel Sur', rut: '76.412.893-5' }).success).toBe(false)
    expect(proveedorSchema.safeParse({ nombre: '--' }).success).toBe(false)
  })
})
