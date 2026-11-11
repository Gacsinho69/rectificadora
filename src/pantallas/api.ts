/** Lo que el servidor rechazó, con su motivo en castellano y el código de la respuesta. */
export class Rechazo extends Error {
  constructor(
    mensaje: string,
    readonly estado: number,
  ) {
    super(mensaje)
  }
}

const sinConexion = (): never => {
  throw new Rechazo('No hay conexión con el servidor. Revisa internet y vuelve a probar.', 0)
}

/** Pide a la API. Si el servidor rechaza, el error trae su motivo; sin sesión, a la pantalla de entrada. */
export async function api<T>(metodo: 'GET' | 'POST', ruta: string, datos?: unknown): Promise<T> {
  // Desde el sistema de una rectificadora, cada pedido dice de qué portal viene: el servidor rechaza (y anota) el de otro.
  const portal = location.pathname.match(/^\/c\/([^/]+)/)?.[1]
  const r = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: { ...(datos === undefined ? {} : { 'content-type': 'application/json' }), ...(portal ? { 'x-portal': decodeURIComponent(portal) } : {}) },
    body: datos === undefined ? undefined : JSON.stringify(datos),
  }).catch(sinConexion)
  const cuerpo = await r.json().catch(() => ({}))
  if (r.status === 401 && location.pathname !== '/entrar') window.location.assign('/entrar')
  if (!r.ok) throw new Rechazo(cuerpo.error ?? 'No se pudo completar.', r.status)
  return cuerpo as T
}

/** Los filtros de una lista como parámetros de la dirección: sin vacíos, las listas separadas por coma. */
export function consulta(filtros: Record<string, unknown>) {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(filtros)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    p.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const texto = p.toString()
  return texto ? `?${texto}` : ''
}
