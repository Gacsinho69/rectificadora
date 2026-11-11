export const TIPOS_INTEGRACION = { webhook: 'Webhook', sso: 'Inicio de sesión único (SSO)', accounting: 'Contabilidad', email: 'Correo' } as const
export type TipoIntegracion = keyof typeof TIPOS_INTEGRACION

export const ESTADOS_INTEGRACION = { active: 'Funcionando', failing: 'Fallando', disabled: 'Apagada' } as const
export type EstadoIntegracion = keyof typeof ESTADOS_INTEGRACION
