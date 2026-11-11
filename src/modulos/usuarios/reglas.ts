export const ROLES_TENANT = { admin: 'Administrador', member: 'Usuario', viewer: 'Solo lectura' } as const
export type RolTenant = keyof typeof ROLES_TENANT

export const ESTADOS_USUARIO = { active: 'Activo', blocked: 'Bloqueado', invited: 'Invitado' } as const
export type EstadoUsuario = keyof typeof ESTADOS_USUARIO
