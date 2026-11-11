// Los catálogos del negocio: estados, planes con sus límites y las funciones que se encienden por cliente.
// Sin dependencias del servidor: las pantallas los importan igual.

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
  /** Usuarios con cuenta (activos o bloqueados; los invitados no cuentan hasta que entran). */
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

export const FUNCIONES = {
  client_portal: 'Portal de clientes',
  ai_quotes: 'Cotizador con IA',
  inventory: 'Inventario de repuestos',
  public_api: 'API pública',
  e_invoicing: 'Facturación electrónica',
  planner_beta: 'Planificador (beta)',
} as const
export type Funcion = keyof typeof FUNCIONES

/** Las funciones que trae cada plan al crear el cliente; después se encienden o apagan una por una. */
export const FUNCIONES_DEL_PLAN: Record<Plan, Funcion[]> = {
  free: [],
  starter: ['client_portal'],
  pro: ['client_portal', 'ai_quotes', 'inventory', 'e_invoicing'],
  enterprise: ['client_portal', 'ai_quotes', 'inventory', 'public_api', 'e_invoicing'],
}

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
