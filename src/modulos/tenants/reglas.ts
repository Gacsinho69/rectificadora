// Los catálogos del negocio: estados, planes con sus límites y las funciones que se encienden por cliente, y lo que
// pide el alta de una rectificadora nueva. Sin dependencias del servidor: las pantallas los importan igual.
import { z } from 'zod'
import { PLANTILLAS_TALLER } from '../taller/reglas'
import { correoSchema } from '../usuarios/reglas'

const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]

export const ESTADOS_TENANT = {
  active: 'Activo',
  trial: 'En prueba',
  past_due: 'Pago vencido',
  suspended: 'Suspendido',
  cancelled: 'Cancelado',
} as const
export type EstadoTenant = keyof typeof ESTADOS_TENANT

/** De qué estado se puede pasar a cuál a mano. «Pago vencido» lo pone el cobro, no una persona. */
export const CAMBIOS_DE_ESTADO: Record<EstadoTenant, EstadoTenant[]> = {
  active: ['suspended', 'cancelled'],
  trial: ['active', 'suspended', 'cancelled'],
  past_due: ['active', 'suspended', 'cancelled'],
  suspended: ['active', 'cancelled'],
  cancelled: ['active'],
}

export const ESTADOS_PAGO = {
  paid: 'Al día',
  past_due: 'Vencido',
  failed: 'Fallido',
  cancelled: 'Cancelado',
  none: 'Sin cobro',
} as const
export type EstadoPago = keyof typeof ESTADOS_PAGO

export type Limites = {
  /** Usuarios con cuenta: activos, bloqueados e invitados (una invitación ya ocupa su lugar). */
  users: number
  storage_mb: number
  api_calls_month: number
  work_orders_month: number
}

export const LIMITES: Record<keyof Limites, { nombre: string; unidad: string }> = {
  users: { nombre: 'Usuarios', unidad: '' },
  storage_mb: { nombre: 'Almacenamiento', unidad: 'MB' },
  api_calls_month: { nombre: 'Llamadas a la API (mes)', unidad: '' },
  work_orders_month: { nombre: 'Órdenes de trabajo (mes)', unidad: '' },
}

export const PLANES = {
  free: { nombre: 'Free', precio: 0, limites: { users: 3, storage_mb: 1_024, api_calls_month: 10_000, work_orders_month: 30 } },
  starter: { nombre: 'Starter', precio: 39_000, limites: { users: 10, storage_mb: 10_240, api_calls_month: 100_000, work_orders_month: 200 } },
  pro: { nombre: 'Pro', precio: 89_000, limites: { users: 30, storage_mb: 51_200, api_calls_month: 500_000, work_orders_month: 1_000 } },
  enterprise: {
    nombre: 'Enterprise',
    precio: 249_000,
    limites: { users: 200, storage_mb: 512_000, api_calls_month: 5_000_000, work_orders_month: 10_000 },
  },
} as const satisfies Record<string, { nombre: string; precio: number; limites: Limites }>
export type Plan = keyof typeof PLANES

/** Los límites que rigen: los del plan, con lo que se haya ajustado a mano para ese cliente. */
export const limitesDe = (plan: Plan, ajustes: Partial<Limites>): Limites => ({ ...PLANES[plan].limites, ...ajustes })

/**
 * Los módulos que se encienden por cliente. Apagado, su menú no aparece y el servidor no lo atiende: sin compras no hay
 * órdenes de compra ni proveedores (los repuestos se reciben en la OT); sin máquinas, una parada no frena trabajos.
 */
export const FUNCIONES = {
  purchasing: 'Compras y proveedores',
  supplies: 'Bodega de insumos',
  machines: 'Máquinas y mantención',
} as const
export type Funcion = keyof typeof FUNCIONES

/** Las funciones que trae cada plan al crear el cliente; después se encienden o apagan una por una. */
export const FUNCIONES_DEL_PLAN: Record<Plan, Funcion[]> = {
  free: ['purchasing'],
  starter: ['purchasing', 'supplies'],
  pro: ['purchasing', 'supplies', 'machines'],
  enterprise: ['purchasing', 'supplies', 'machines'],
}

/** Las funciones encendidas de un cliente, de sus banderas guardadas. */
export const funcionesDe = (banderas: Partial<Record<string, boolean>>) => (Object.keys(FUNCIONES) as Funcion[]).filter((f) => banderas[f])

/** Lo que se mide del uso del producto día a día: indica si el cliente realmente lo ocupa. */
export const USOS_CLAVE = {
  work_orders: 'Órdenes de trabajo',
  quotes: 'Cotizaciones',
  client_portal: 'Portal de clientes',
  inventory: 'Inventario',
  reports: 'Reportes',
  api: 'API',
} as const
export type UsoClave = keyof typeof USOS_CLAVE

export const REGIONES = { 'sa-1': 'Sudamérica 1 (Santiago)', 'sa-2': 'Sudamérica 2 (São Paulo)', 'na-1': 'Norteamérica 1' } as const
export type Region = keyof typeof REGIONES

/** Los subdominios que no puede tomar una rectificadora: son de la plataforma o se confunden con ella. */
export const SUBDOMINIOS_RESERVADOS = ['www', 'api', 'app', 'admin', 'administracion', 'plataforma', 'consola', 'soporte', 'ayuda', 'mail', 'correo', 'static', 'assets', 'cdn', 'organizacion', 'entrar', 'salir', 'demo', 'test', 'status', 'blog']

/** El subdominio que se propone para un nombre: «Rectificadora Ñuble Sur» → «nuble-sur». */
export const subdominioDe = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^rectificadoras?\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')

/** Qué tiene de malo un subdominio, en palabras de quien lo escribe; null si sirve. */
export function faltaDelSubdominio(s: string): string | null {
  if (!/^[a-z0-9-]{3,40}$/.test(s)) return 'El subdominio va de 3 a 40 letras sin tildes, números o guiones.'
  if (s.startsWith('-') || s.endsWith('-') || s.includes('--')) return 'El subdominio no empieza ni termina con guion, ni lleva dos seguidos.'
  if (SUBDOMINIOS_RESERVADOS.includes(s)) return `«${s}» es de la plataforma: elige otro.`
  return null
}

/**
 * El alta de una rectificadora desde la consola: quién es, su subdominio, su plan (en prueba o activo desde ya), con qué
 * taller nace y su primer administrador. El motivo queda en la auditoría.
 */
export const altaTenantSchema = z.object({
  nombre: z.string({ error: 'Escribe el nombre de la rectificadora.' }).trim().min(3, 'Escribe el nombre de la rectificadora.').max(120),
  subdominio: z
    .string({ error: 'Escribe el subdominio.' })
    .trim()
    .toLowerCase()
    .superRefine((s, ctx) => {
      const falta = faltaDelSubdominio(s)
      if (falta) ctx.addIssue({ code: 'custom', message: falta })
    }),
  region: z.enum(claves(REGIONES)),
  plan: z.enum(claves(PLANES)),
  estado: z.enum(['trial', 'active']),
  /** Cuántos días de prueba, si parte en prueba. */
  diasPrueba: z.number().int().min(1, 'La prueba dura al menos un día.').max(90, 'La prueba dura a lo más 90 días.').default(14),
  /** Un precio distinto al de lista (Enterprise negociado). Vacío: el de lista. */
  mrr: z.number().int().min(0).max(100_000_000).nullable().optional(),
  correoFacturacion: correoSchema,
  plantilla: z.enum(claves(PLANTILLAS_TALLER), { error: 'Elige con qué taller parte.' }),
  administrador: z.object({
    nombre: z.string({ error: 'Escribe el nombre del administrador.' }).trim().min(3, 'Escribe el nombre del administrador.').max(120),
    correo: correoSchema,
  }),
  motivo: z.string({ error: 'Escribe el motivo.' }).trim().min(10, 'Escribe el motivo (al menos 10 letras): queda en la auditoría.').max(500),
})
export type DatosAltaTenant = z.infer<typeof altaTenantSchema>
