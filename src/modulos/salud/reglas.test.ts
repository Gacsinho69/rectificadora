import { describe, expect, it } from 'vitest'
import { alertasDeTenant, type DatosAlerta } from '../alertas/reglas'
import { calcularSalud, type DatosSalud } from './reglas'

const sano: DatosSalud = { diasSinLogin: 0.2, usuariosTotal: 10, usuariosActivos7d: 8, funcionesUsadas: 5, funcionesTotal: 6, estadoPago: 'paid', errores7d: 0, usoMaximo: 0.4 }

describe('salud del cliente', () => {
  it('un cliente recién creado tiene 14 días de gracia para empezar a usar el sistema; el pago cuenta desde el primero', () => {
    const recien: DatosSalud = { diasSinLogin: null, usuariosTotal: 1, usuariosActivos7d: 0, funcionesUsadas: 0, funcionesTotal: 6, estadoPago: 'none', errores7d: 0, usoMaximo: 0.1 }
    const nuevo = calcularSalud({ ...recien, diasDeVida: 2 })
    expect(nuevo).toMatchObject({ estado: 'healthy', puntaje: 100, nuevo: true })
    expect(nuevo.factores[0].detalle).toBe('Nadie ha entrado nunca · en sus primeros 14 días no se descuenta')
    expect(calcularSalud({ ...recien, diasDeVida: 20 })).toMatchObject({ estado: 'at_risk', puntaje: 40, nuevo: false })
    expect(calcularSalud({ ...recien, diasDeVida: 2, estadoPago: 'failed' }).puntaje).toBe(80)
  })

  it('un cliente activo, al día y sin errores está sano', () => {
    const s = calcularSalud(sano)
    expect(s.estado).toBe('healthy')
    expect(s.puntaje).toBeGreaterThanOrEqual(90)
    expect(s.factores.reduce((suma, f) => suma + f.maximo, 0)).toBe(100)
  })

  it('cada problema resta y el estado baja por tramos', () => {
    expect(calcularSalud({ ...sano, diasSinLogin: 10, usuariosActivos7d: 2 }).estado).toBe('warning')
    // 3 + 0 + 8 + 8 + 10 + 10 = 39
    expect(calcularSalud({ ...sano, diasSinLogin: 20, usuariosActivos7d: 0, estadoPago: 'past_due', funcionesUsadas: 3 }).estado).toBe('at_risk')
    expect(calcularSalud({ ...sano, diasSinLogin: null, usuariosActivos7d: 0, funcionesUsadas: 0, estadoPago: 'past_due', errores7d: 9 }).estado).toBe('critical')
  })

  it('pago fallido y sin entrar hace dos semanas es crítico aunque lo demás esté bien', () => {
    expect(calcularSalud({ ...sano, estadoPago: 'failed', diasSinLogin: 20 }).estado).toBe('critical')
  })
})

const base: DatosAlerta = {
  tenantId: 'tn_x',
  nombre: 'X',
  estado: 'active',
  estadoPago: 'paid',
  creado: new Date('2026-01-01'),
  trialVence: null,
  diasSinLogin: 0.5,
  usos: [{ nombre: 'Usuarios', fraccion: 0.3 }],
  fallidos24h: 0,
  erroresCriticos24h: 0,
  webhooksFallidos24h: 0,
  jobsFallidos24h: 0,
  crossTenant7d: 0,
  apiAyer: 1000,
  apiMediana14d: 900,
}
const ahora = new Date('2026-11-11T15:00:00Z')
const tipos = (d: Partial<DatosAlerta>) => alertasDeTenant({ ...base, ...d }, ahora).map((a) => `${a.tipo}:${a.prioridad}`)

describe('alertas', () => {
  it('un cliente sin problemas no tiene alertas', () => expect(tipos({})).toEqual([]))

  it('inactividad a los 14 y 30 días, y nunca entró', () => {
    expect(tipos({ diasSinLogin: 15 })).toEqual(['inactividad:medium'])
    expect(tipos({ diasSinLogin: 31 })).toEqual(['inactividad:high'])
    expect(tipos({ diasSinLogin: null })).toEqual(['inactividad:high'])
  })

  it('la prueba por vencer y vencida', () => {
    const en = (dias: number) => ({ estado: 'trial' as const, trialVence: new Date(ahora.getTime() + dias * 86_400_000) })
    expect(tipos(en(2))).toEqual(['trial:high'])
    expect(tipos(en(6))).toEqual(['trial:medium'])
    expect(tipos(en(-1))).toEqual(['trial:high'])
    expect(tipos(en(20))).toEqual([])
  })

  it('límites al 80 y 90 %', () => {
    expect(tipos({ usos: [{ nombre: 'Almacenamiento', fraccion: 0.85 }] })).toEqual(['limite:medium'])
    expect(tipos({ usos: [{ nombre: 'Almacenamiento', fraccion: 0.95 }] })).toEqual(['limite:high'])
  })

  it('seguridad y operación, aunque el cliente esté suspendido', () => {
    expect(tipos({ estado: 'suspended', crossTenant7d: 1, fallidos24h: 30, erroresCriticos24h: 1, estadoPago: 'failed', diasSinLogin: 60 })).toEqual([
      'cross_tenant:critical',
      'error_critico:critical',
      'logins_fallidos:critical',
      'pago:high',
    ])
  })

  it('consumo anormal: más del triple de la mediana, con volumen', () => {
    expect(tipos({ apiAyer: 7000, apiMediana14d: 1000 })).toEqual(['consumo_anormal:high'])
    expect(tipos({ apiAyer: 4000, apiMediana14d: 1000 })).toEqual(['consumo_anormal:medium'])
    expect(tipos({ apiAyer: 500, apiMediana14d: 50 })).toEqual([])
  })
})
