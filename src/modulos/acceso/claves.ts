// Las claves y los secretos de sesión e invitación. Una clave no se guarda: se guarda su derivación con scrypt y una sal
// al azar por clave, y se compara en tiempo constante. Los secretos (de la cookie, del enlace) se guardan solo como su
// huella sha256.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 16_384
const R = 8
const P = 1
const LARGO = 32

const derivar = (clave: string, sal: Buffer, n = N, r = R, p = P) =>
  new Promise<Buffer>((listo, falla) => scrypt(clave.normalize('NFKC'), sal, LARGO, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? falla(e) : listo(k))))

/** Lo que se guarda de una clave: «scrypt$N$r$p$sal$derivada». */
export async function cifrarClave(clave: string): Promise<string> {
  const sal = randomBytes(16)
  const k = await derivar(clave, sal)
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${k.toString('base64')}`
}

/** Si la clave calza con lo guardado. Sin nada guardado, igual se calcula, para que la respuesta tarde lo mismo. */
export async function claveCorrecta(clave: string, guardada: string | null): Promise<boolean> {
  const [tipo, n, r, p, sal, derivada] = (guardada ?? FALSA).split('$')
  if (tipo !== 'scrypt') return false
  const k = await derivar(clave, Buffer.from(sal, 'base64'), Number(n), Number(r), Number(p))
  const esperada = Buffer.from(derivada, 'base64')
  return Boolean(guardada) && k.length === esperada.length && timingSafeEqual(k, esperada)
}
// Una derivación cualquiera, para gastar el mismo tiempo cuando el correo no existe.
const FALSA = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(LARGO).toString('base64')}`

/** Un secreto al azar para una cookie o un enlace, y su huella, que es lo que se guarda. */
export function nuevoSecreto() {
  const secreto = randomBytes(32).toString('base64url')
  return { secreto, huella: huellaDe(secreto) }
}

export const huellaDe = (secreto: string) => createHash('sha256').update(secreto).digest('hex')

/** Lo mínimo de una clave: 8 letras o más, y que no sea el correo. */
export function faltaDeLaClave(clave: string, correo?: string): string | null {
  if (clave.length < 8) return 'La clave debe tener al menos 8 letras o números.'
  if (correo && clave.toLowerCase() === correo.toLowerCase()) return 'La clave no puede ser el correo.'
  return null
}
