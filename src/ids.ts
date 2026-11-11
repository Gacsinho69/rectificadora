// Identificadores con prefijo (tn_, us_, ev_…): se leen en un log y se sabe de qué son. Sin letras que se confundan.
const ALFABETO = '0123456789abcdefghjkmnpqrstvwxyz'

/** El azar es el criptográfico; la siembra de demostración pasa el suyo para que los datos salgan siempre iguales. */
export function nuevoId(prefijo: string, azar?: () => number): string {
  const valores = azar ? Array.from({ length: 12 }, () => Math.floor(azar() * 256)) : crypto.getRandomValues(new Uint8Array(12))
  let cuerpo = ''
  for (const v of valores) cuerpo += ALFABETO[v % ALFABETO.length]
  return `${prefijo}_${cuerpo}`
}
