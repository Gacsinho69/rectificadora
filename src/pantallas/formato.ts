// Cómo se escriben cifras y fechas: castellano de Chile, pesos sin decimales, fechas cortas.
const pesos = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
const numero = new Intl.NumberFormat('es-CL')
const compacto = new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 })
const corta = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
const conHora = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
const soloHora = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit' })

export const plata = (n: number) => pesos.format(n)
export const cifra = (n: number) => numero.format(n)
export const cifraCorta = (n: number) => (Math.abs(n) >= 10_000 ? compacto.format(n) : numero.format(n))
/** «1 cliente», «3 clientes». */
export const plural = (n: number, palabra: string, plural = `${palabra}s`) => `${cifra(n)} ${n === 1 ? palabra : plural}`
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
