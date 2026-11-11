/**
 * Los roles dentro de una rectificadora. El administrador además ve el panel de la organización; el jefe de taller
 * recibe, cotiza, asigna y entrega; el técnico hace los trabajos de su sección y no ve montos; solo lectura mira todo.
 */
export const ROLES_TENANT = { admin: 'Administrador', planner: 'Jefe de taller', technician: 'Técnico', viewer: 'Solo lectura' } as const
export type RolTenant = keyof typeof ROLES_TENANT

export const ESTADOS_USUARIO = { active: 'Activo', blocked: 'Bloqueado', invited: 'Invitado' } as const
export type EstadoUsuario = keyof typeof ESTADOS_USUARIO
