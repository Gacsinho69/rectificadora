// La lista de clientes: filtros y orden sobre el panorama. Los mismos nombres viajan en la dirección de la pantalla,
// así una lista filtrada se puede compartir con un enlace.
import { z } from 'zod'
import { ESTADOS_SALUD, type EstadoSalud } from '../salud/reglas'
import { ESTADOS_PAGO, ESTADOS_TENANT, PLANES } from '../tenants/reglas'
import type { ResumenTenant } from './panorama'
import { diaSchema } from '../../fecha'
import { diaEnChile } from '../taller/reglas'

export const NIVELES_USO = { bajo: 'Menos de 50 %', medio: '50 a 80 %', alto: '80 a 90 %', limite: '90 % o más' } as const
export type NivelUso = keyof typeof NIVELES_USO

export const ACTIVIDAD = {
  hoy: 'Entraron hoy',
  semana: 'En los últimos 7 días',
  mes: 'En los últimos 30 días',
  sin14: 'Sin actividad hace 14 días o más',
  sin30: 'Sin actividad hace 30 días o más',
  nunca: 'Nunca han entrado',
} as const
export type Actividad = keyof typeof ACTIVIDAD

export const ORDENES = {
  nombre: 'Nombre',
  ultimoLogin: 'Último ingreso',
  usuarios: 'Usuarios',
  creado: 'Creación',
  mrr: 'MRR',
  estado: 'Estado',
  uso: 'Uso del plan',
  salud: 'Salud',
} as const
export type Orden = keyof typeof ORDENES

/** Una lista separada por comas en la dirección (`estado=active,trial`) o repetida. */
const varios = <T extends string>(valores: readonly [T, ...T[]]) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).filter(Boolean))
    .pipe(z.array(z.enum(valores)))
    .optional()

const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]
const fecha = diaSchema.optional()

export const filtrosTenants = z.object({
  q: z.string().trim().max(120).optional(),
  estado: varios(claves(ESTADOS_TENANT)),
  plan: varios(claves(PLANES)),
  pago: varios(claves(ESTADOS_PAGO)),
  salud: varios(claves(ESTADOS_SALUD)),
  uso: z.enum(claves(NIVELES_USO)).optional(),
  actividad: z.enum(claves(ACTIVIDAD)).optional(),
  creadoDesde: fecha,
  creadoHasta: fecha,
  orden: z.enum(claves(ORDENES)).default('ultimoLogin'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(10).max(200).default(50),
})
export type FiltrosTenants = z.infer<typeof filtrosTenants>

const enNivel = (fraccion: number, nivel: NivelUso) =>
  nivel === 'bajo' ? fraccion < 0.5 : nivel === 'medio' ? fraccion >= 0.5 && fraccion < 0.8 : nivel === 'alto' ? fraccion >= 0.8 && fraccion < 0.9 : fraccion >= 0.9

function enActividad(dias: number | null, actividad: Actividad) {
  if (actividad === 'nunca') return dias === null
  if (dias === null) return false
  return { hoy: dias < 1, semana: dias < 7, mes: dias < 30, sin14: dias >= 14, sin30: dias >= 30 }[actividad]
}

const ORDEN_ESTADO = { active: 0, trial: 1, past_due: 2, suspended: 3, cancelled: 4 }
const ORDEN_SALUD: Record<EstadoSalud, number> = { critical: 0, at_risk: 1, warning: 2, healthy: 3 }

const valorDeOrden: Record<Orden, (t: ResumenTenant) => number | string> = {
  nombre: (t) => t.nombre.toLocaleLowerCase('es'),
  // Sin ingresos queda al final en el orden descendente: «nunca» es lo más antiguo.
  ultimoLogin: (t) => (t.ultimoLogin ? Date.parse(t.ultimoLogin) : 0),
  usuarios: (t) => t.usuarios.total,
  creado: (t) => Date.parse(t.creado),
  mrr: (t) => t.mrr,
  estado: (t) => ORDEN_ESTADO[t.estado],
  uso: (t) => t.usoMaximo,
  salud: (t) => (t.salud ? t.salud.puntaje : -1),
}

/**
 * Busca por nombre, subdominio, id del cliente, correo de facturación o el correo de cualquiera de sus usuarios
 * (`correosDe`, que arma la ruta con una sola consulta).
 */
/** Sin tildes ni mayúsculas: «biobio» encuentra «Biobío». */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function filtrarTenants(lista: ResumenTenant[], f: FiltrosTenants, correosDe: Map<string, string[]> = new Map()) {
  const q = f.q ? normalizar(f.q) : undefined
  const filtradas = lista.filter(
    (t) =>
      (!q ||
        normalizar(t.nombre).includes(q) ||
        t.slug.includes(q) ||
        t.id.toLowerCase() === q ||
        t.id.toLowerCase().startsWith(q) ||
        t.correoFacturacion.toLowerCase().includes(q) ||
        (correosDe.get(t.id) ?? []).some((c) => c.toLowerCase().includes(q))) &&
      (!f.estado?.length || f.estado.includes(t.estado)) &&
      (!f.plan?.length || f.plan.includes(t.plan)) &&
      (!f.pago?.length || f.pago.includes(t.estadoPago)) &&
      (!f.salud?.length || (t.salud && f.salud.includes(t.salud.estado))) &&
      (!f.uso || enNivel(t.usoMaximo, f.uso)) &&
      (!f.actividad || enActividad(t.diasSinLogin, f.actividad)) &&
      // El día de Chile, el mismo que muestra la columna «Creado».
      (!f.creadoDesde || diaEnChile(new Date(t.creado)) >= f.creadoDesde) &&
      (!f.creadoHasta || diaEnChile(new Date(t.creado)) <= f.creadoHasta),
  )
  const valor = valorDeOrden[f.orden]
  const signo = f.dir === 'asc' ? 1 : -1
  filtradas.sort((a, b) => {
    const va = valor(a)
    const vb = valor(b)
    const comparacion = typeof va === 'string' ? va.localeCompare(vb as string, 'es') : va - (vb as number)
    return signo * comparacion || a.nombre.localeCompare(b.nombre, 'es')
  })
  const desde = (f.pagina - 1) * f.porPagina
  return { total: filtradas.length, filas: filtradas.slice(desde, desde + f.porPagina) }
}
