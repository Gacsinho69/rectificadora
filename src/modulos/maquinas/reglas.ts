// Las máquinas del taller, sin servidor: las pantallas importan esto igual.
//
// Cada máquina sirve a unas actividades (la lineadora, al lineado de bancada). Si para, en falla o en mantención, los
// trabajos de esas actividades quedan en «máquina detenida» y no se inician hasta que vuelva a operar: el tablero lo
// dice solo, como con los repuestos. La mantención se lleva por días: cada cuánto y cuándo fue la última.
import { type ClaveSeccion, SECCIONES_INICIALES } from '../taller/reglas'

export const MOTIVOS_PARADA = { breakdown: 'En falla', maintenance: 'En mantención' } as const
export type MotivoParada = keyof typeof MOTIVOS_PARADA

const DIA = 86_400_000

/**
 * Cuándo le toca la próxima mantención y cuántos días faltan (negativo: vencida). Sin frecuencia no se lleva; con
 * frecuencia y sin ninguna hecha, está vencida desde ya.
 */
export function mantencionDe(ultima: string | null, cadaDias: number | null, hoy: string): { proxima: string | null; dias: number | null; vencida: boolean } {
  if (!cadaDias) return { proxima: null, dias: null, vencida: false }
  if (!ultima) return { proxima: null, dias: null, vencida: true }
  const proxima = new Date(Date.parse(`${ultima}T12:00:00Z`) + cadaDias * DIA).toISOString().slice(0, 10)
  const dias = Math.round((Date.parse(`${proxima}T12:00:00Z`) - Date.parse(`${hoy}T12:00:00Z`)) / DIA)
  return { proxima, dias, vencida: dias < 0 }
}

/**
 * Las máquinas con que nace una rectificadora, cada una con las actividades que la necesitan. Al darla de alta se
 * crean las que sirven a alguna actividad de su plantilla (un taller de culatas no tiene rectificadora de cigüeñal).
 */
export const MAQUINAS_INICIALES: { nombre: string; seccion: ClaveSeccion; codigos: string[]; cadaDias: number }[] = [
  { nombre: 'Banco de prueba hidráulica', seccion: 'diagnostico', codigos: ['D-04'], cadaDias: 180 },
  { nombre: 'Cepilladora', seccion: 'culatas', codigos: ['C-01', 'B-04'], cadaDias: 90 },
  { nombre: 'Rectificadora de asientos', seccion: 'culatas', codigos: ['C-02', 'C-05'], cadaDias: 90 },
  { nombre: 'Rectificadora de válvulas', seccion: 'culatas', codigos: ['C-03'], cadaDias: 90 },
  { nombre: 'Rectificadora de cilindros', seccion: 'block', codigos: ['B-01'], cadaDias: 60 },
  { nombre: 'Bruñidora', seccion: 'block', codigos: ['B-02'], cadaDias: 60 },
  { nombre: 'Lineadora de bancada', seccion: 'block', codigos: ['B-05'], cadaDias: 120 },
  { nombre: 'Rectificadora de cigüeñal', seccion: 'cigueñal', codigos: ['G-01', 'G-02'], cadaDias: 60 },
  { nombre: 'Balanceadora', seccion: 'cigueñal', codigos: ['G-03'], cadaDias: 180 },
]

/**
 * Las máquinas de un taller recién creado: las de `MAQUINAS_INICIALES` que sirven a alguna de sus actividades, en su
 * sección, con la mantención contada desde `hoy`. Devuelve las filas listas para guardar.
 */
export function maquinasIniciales(tenantId: string, secciones: { id: string; name: string }[], trabajos: { id: string; code: string }[], id: (prefijo: string) => string, hoy: string) {
  const seccionDe = (clave: ClaveSeccion) => secciones.find((s) => s.name === SECCIONES_INICIALES.find((x) => x.clave === clave)?.nombre)?.id ?? null
  const maquinas: { id: string; tenantId: string; name: string; sectionId: string | null; maintenanceEveryDays: number; lastMaintenanceAt: string; active: boolean }[] = []
  const usos: { tenantId: string; machineId: string; serviceId: string }[] = []
  for (const m of MAQUINAS_INICIALES) {
    const suyas = trabajos.filter((t) => m.codigos.includes(t.code))
    if (!suyas.length) continue
    const maquinaId = id('maq')
    maquinas.push({ id: maquinaId, tenantId, name: m.nombre, sectionId: seccionDe(m.seccion), maintenanceEveryDays: m.cadaDias, lastMaintenanceAt: hoy, active: true })
    usos.push(...suyas.map((t) => ({ tenantId, machineId: maquinaId, serviceId: t.id })))
  }
  return { maquinas, usos }
}
