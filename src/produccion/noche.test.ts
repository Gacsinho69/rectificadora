import { describe, expect, it } from 'vitest'
import { abrirBase } from '../base'
import { sembrarDemo } from '../modulos/demo/sembrar'
import { platformAdmins } from '../modulos/usuarios/tablas'
import { mensajeDeError } from '../servidor'

describe('lo que se anota de un error', () => {
  it('el motivo, sin la consulta ni sus valores (un hash de clave no queda en el registro)', () => {
    const consulta = Object.assign(new Error('Failed query: update "users" set "password_hash" = $1\nparams: scrypt$16384$8$1$abc$def'), { cause: new Error('terminating connection due to administrator command') })
    expect(mensajeDeError(consulta)).toBe('terminating connection due to administrator command')
    expect(mensajeDeError(new Error('Failed query: select 1 params: secreto'))).toBe('Failed query: select 1')
  })
})

describe('la demostración', () => {
  it('no se siembra si ya hay alguien del equipo, aunque no haya rectificadoras', async () => {
    const base = await abrirBase()
    await base.insert(platformAdmins).values({ id: 'adm_real', name: 'Equipo', email: 'equipo@plataforma.test', permissions: [] })
    expect(await sembrarDemo(base)).toBe(false)
  })
})
