// El equipo de la plataforma, desde la consola de comandos del servidor (con la misma configuración que `npm start`):
//
//   npm run equipo -- agregar --correo ana@empresa.cl --nombre "Ana Pérez"
//   npm run equipo -- clave --correo ana@empresa.cl
//
// Cada uno muestra una clave de paso: con ella se entra a la consola y se cambia al tiro por una propia.
import { parseArgs } from 'node:util'
import { abrirPostgres } from '../base'
import { agregarAlEquipo, claveDePasoDelEquipo } from '../modulos/acceso/equipo'
import { leerConfiguracion } from './configuracion'

const USO = `Uso:
  npm run equipo -- agregar --correo ana@empresa.cl --nombre "Ana Pérez"   suma a alguien al equipo, con todos los permisos
  npm run equipo -- clave --correo ana@empresa.cl                          le da una clave de paso nueva (cierra sus sesiones)`

const { positionals, values } = parseArgs({ allowPositionals: true, strict: false, options: { correo: { type: 'string' }, nombre: { type: 'string' } } })
const accion = positionals[0]
const correo = typeof values.correo === 'string' ? values.correo : ''
const nombre = typeof values.nombre === 'string' ? values.nombre : ''

if ((accion !== 'agregar' && accion !== 'clave') || !correo || (accion === 'agregar' && !nombre)) {
  console.error(USO)
  process.exit(1)
}

try {
  const config = leerConfiguracion(process.env)
  const { base, cerrar } = await abrirPostgres(config.baseDeDatos)
  try {
    const { clave } = accion === 'agregar' ? await agregarAlEquipo(base, { correo, nombre }) : await claveDePasoDelEquipo(base, correo)
    console.log(accion === 'agregar' ? `Listo: ${nombre} es del equipo, con todos los permisos.` : `Listo: ${correo} tiene una clave de paso nueva y sus sesiones quedaron cerradas.`)
    console.log(`Clave de paso: ${clave}`)
    console.log(`Se entra en https://${config.dominio}/entrar?portal=plataforma y se cambia al tiro (abajo a la izquierda, «Cambiar clave»).`)
  } finally {
    await cerrar()
  }
} catch (e) {
  console.error((e as Error).message)
  process.exit(1)
}
