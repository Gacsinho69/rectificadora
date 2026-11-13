// El RUT chileno: cuerpo y dígito verificador (módulo 11). Sin servidor: lo usan las reglas y las pantallas.

const limpio = (rut: string) => rut.replace(/[^0-9kK]/g, '').toUpperCase()

/** El dígito verificador que le corresponde a un cuerpo: 0 a 9, o K. */
export function digitoVerificador(cuerpo: number | string): string {
  let suma = 0
  let factor = 2
  for (const d of String(cuerpo).split('').reverse()) {
    suma += Number(d) * factor
    factor = factor === 7 ? 2 : factor + 1
  }
  const resto = 11 - (suma % 11)
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
}

/** Que el RUT esté bien escrito: con o sin puntos y guion, y con el dígito verificador que le toca. */
export function rutValido(rut: string): boolean {
  const r = limpio(rut)
  if (!/^\d{6,8}[0-9K]$/.test(r)) return false
  return digitoVerificador(r.slice(0, -1)) === r.slice(-1)
}

/** «76.123.456-7», como se escribe en una orden de compra. */
export function formatoRut(rut: string): string {
  const r = limpio(rut)
  return `${Number(r.slice(0, -1)).toLocaleString('es-CL')}-${r.slice(-1)}`
}
