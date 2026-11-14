// Cómo se escriben cifras y fechas: castellano de Chile, pesos sin decimales, fechas cortas.
const pesos = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
const numero = new Intl.NumberFormat('es-CL')
const compacto = new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 })
const corta = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
// La hora como se dice en el taller: «15:13», no «03:13 p. m.».
const conHora = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const soloHora = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** «$57.800»; lo negativo con el signo adelante, «-$57.800» (Intl lo pone después del peso). */
export const plata = (n: number) => (n < 0 ? `-${pesos.format(-n)}` : pesos.format(n))
export const cifra = (n: number) => numero.format(n)
export const cifraCorta = (n: number) => (Math.abs(n) >= 10_000 ? compacto.format(n) : numero.format(n))
/** «1 cliente», «3 clientes». */
export const plural = (n: number, palabra: string, plural = `${palabra}s`) => `${cifra(n)} ${n === 1 ? palabra : plural}`
/**
 * Una cantidad con su unidad, en plural cuando corresponde: «1 litro», «27 litros», «2 unidades», «0,5 litros». Una
 * unidad abreviada o de varias palabras («kg», «caja de 12») queda como está.
 */
export const cantidad = (n: number, unidad: string) => `${cifra(n)} ${unidadPara(n, unidad)}`.trim()
/** Solo la unidad, en singular o plural según la cantidad (para cuando la cifra va aparte, en negrita). */
export function unidadPara(n: number, unidad: string) {
  const u = unidad.trim()
  if (Math.abs(n) === 1 || !u || u.includes(' ') || u.length <= 3 || /[sx]$/i.test(u)) return u
  return /[aeiouáéó]$/i.test(u) ? `${u}s` : `${u}es`
}
export const porcentaje = (f: number) => `${Math.round(f * 100)} %`
export const fecha = (iso: string | null | undefined) => (iso ? corta.format(new Date(iso)) : '—')
export const fechaHora = (iso: string | null | undefined) => (iso ? conHora.format(new Date(iso)) : '—')
export const hora = (iso: string) => soloHora.format(new Date(iso))

/** «hace 3 h», «hace 12 d», «nunca». La fecha exacta va en el título, al pasar el mouse. */
export function hace(iso: string | null | undefined, ahora = Date.now()) {
  if (!iso) return 'nunca'
  const s = (ahora - Date.parse(iso)) / 1000
  if (s < 0) return `en ${haceTexto(-s)}`
  return `hace ${haceTexto(s)}`
}
function haceTexto(s: number) {
  if (s < 90) return 'un momento'
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86_400 * 1.5) return `${Math.round(s / 3600)} h`
  if (s < 86_400 * 60) return `${Math.round(s / 86_400)} d`
  return `${Math.round(s / (86_400 * 30))} meses`
}

export const megas = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toLocaleString('es-CL', { maximumFractionDigits: 1 })} GB` : `${cifra(mb)} MB`)
