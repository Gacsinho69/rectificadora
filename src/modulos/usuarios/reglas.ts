import { z } from 'zod'

/**
 * Los roles dentro de una rectificadora. El administrador además ve el panel de la organización; el jefe de taller
 * recibe, cotiza, asigna y entrega; el técnico hace los trabajos de su sección y no ve montos; solo lectura mira todo.
 */
export const ROLES_TENANT = { admin: 'Administrador', planner: 'Jefe de taller', technician: 'Técnico', viewer: 'Solo lectura' } as const
export type RolTenant = keyof typeof ROLES_TENANT

export const ESTADOS_USUARIO = { active: 'Activo', blocked: 'Bloqueado', invited: 'Invitado' } as const
export type EstadoUsuario = keyof typeof ESTADOS_USUARIO

/** Un correo se guarda sin espacios y en minúsculas: «Rosa@Nuble.cl» y «rosa@nuble.cl» son la misma persona. */
export const correoSchema = z.string({ error: 'Escribe el correo.' }).trim().toLowerCase().max(160).pipe(z.email('El correo no es válido.'))

/** Una persona nueva de una rectificadora: quién es y qué rol tiene. */
export const personaSchema = z.object({
  nombre: z.string({ error: 'Escribe el nombre y el apellido.' }).trim().min(3, 'Escribe el nombre y el apellido.').max(120),
  correo: correoSchema,
  rol: z.enum(Object.keys(ROLES_TENANT) as [RolTenant, ...RolTenant[]], { error: 'Elige el rol.' }),
})
export type DatosPersona = z.infer<typeof personaSchema>
