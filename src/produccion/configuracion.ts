// Lo que el servidor de producción necesita saber, desde sus variables de entorno. Si falta algo no arranca, y dice qué
// falta y cómo se escribe: es mejor que no parta a que parta mal.

export type Configuracion = {
  /** La base PostgreSQL. */
  baseDeDatos: string
  /** Donde queda el sistema: «rectificadora.cl». Cada rectificadora, además, en «<subdominio>.rectificadora.cl». */
  dominio: string
  puerto: number
  /** Siembra la demostración si la base está vacía: para un servidor de prueba, nunca para el de verdad. */
  demostracion: boolean
}

export function leerConfiguracion(env: Record<string, string | undefined>): Configuracion {
  const faltas: string[] = []
  const baseDeDatos = env.DATABASE_URL?.trim() ?? ''
  if (!baseDeDatos) faltas.push('DATABASE_URL: la dirección de la base PostgreSQL, como postgres://usuario:clave@servidor:5432/base')
  else if (!/^postgres(ql)?:\/\//.test(baseDeDatos)) faltas.push('DATABASE_URL tiene que empezar con postgres:// o postgresql://')
  const dominio = env.DOMINIO_PLATAFORMA?.trim().toLowerCase() ?? ''
  if (!dominio) faltas.push('DOMINIO_PLATAFORMA: el dominio del sistema, como rectificadora.cl (sin https:// ni barras)')
  else if (dominio !== 'localhost' && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(dominio)) faltas.push(`DOMINIO_PLATAFORMA «${dominio}» no es un dominio: va como rectificadora.cl, sin https:// ni barras`)
  const puerto = Number(env.PORT?.trim() || 3000)
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65_535) faltas.push(`PORT «${env.PORT}» no es un puerto: un número como 3000`)
  if (faltas.length) throw new Error(`Falta configurar el servidor:\n- ${faltas.join('\n- ')}`)
  return { baseDeDatos, dominio, puerto, demostracion: ['si', 'sí'].includes(env.DEMOSTRACION?.trim().toLowerCase() ?? '') }
}

/** La base sin su clave, para el registro: «postgres://app@db.servidor.cl:5432/rectificadora». */
export function baseSinClave(url: string) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.username ? `${u.username}@` : ''}${u.host}${u.pathname}`
  } catch {
    return 'postgres://…'
  }
}
