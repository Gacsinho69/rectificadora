// Los permisos del equipo de la plataforma. Ser del equipo da lectura global; cada acción sensible pide el suyo.

export const PERMISOS_PLATAFORMA = {
  'tenants.create': 'Dar de alta clientes nuevos',
  'tenants.status': 'Suspender, reactivar o cancelar clientes',
  'tenants.plan': 'Cambiar el plan de un cliente',
  'tenants.limits': 'Ajustar los límites de un cliente',
  'tenants.flags': 'Encender o apagar funciones de un cliente',
  'users.create': 'Agregar usuarios a un cliente',
  'users.block': 'Bloquear y desbloquear usuarios',
  'users.roles': 'Cambiar el rol de usuarios',
  'support.impersonate': 'Entrar como el administrador de un cliente',
  'data.sensitive': 'Ver IPs, ubicaciones y otros datos sensibles',
} as const
export type PermisoPlataforma = keyof typeof PERMISOS_PLATAFORMA

export const TODOS_LOS_PERMISOS = Object.keys(PERMISOS_PLATAFORMA) as PermisoPlataforma[]
