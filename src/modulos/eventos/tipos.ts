// El catálogo de eventos: todo lo importante que pasa en la plataforma queda como uno de estos.
// La categoría ordena la auditoría; la severidad por omisión se puede subir al registrar.

export type Severidad = 'info' | 'warning' | 'error' | 'critical'
export type TipoActor = 'user' | 'platform_admin' | 'system' | 'api_key' | 'anonymous'

export const CATEGORIAS = {
  acceso: 'Inicios de sesión',
  usuarios: 'Usuarios y roles',
  configuracion: 'Cliente y plan',
  facturacion: 'Facturación',
  seguridad: 'Seguridad',
  soporte: 'Accesos de soporte',
  datos: 'Datos',
  sistema: 'Sistema',
  operacion: 'Operación',
} as const
export type Categoria = keyof typeof CATEGORIAS

type Definicion = { nombre: string; categoria: Categoria; severidad: Severidad }

export const TIPOS_DE_EVENTO = {
  'tenant.created': { nombre: 'Cliente creado', categoria: 'configuracion', severidad: 'info' },
  'tenant.updated': { nombre: 'Cliente modificado', categoria: 'configuracion', severidad: 'info' },
  'tenant.suspended': { nombre: 'Cliente suspendido', categoria: 'configuracion', severidad: 'warning' },
  'tenant.reactivated': { nombre: 'Cliente reactivado', categoria: 'configuracion', severidad: 'info' },
  'tenant.cancelled': { nombre: 'Cliente cancelado', categoria: 'configuracion', severidad: 'warning' },
  'tenant.plan_changed': { nombre: 'Cambio de plan', categoria: 'configuracion', severidad: 'info' },
  'tenant.limits_changed': { nombre: 'Límites ajustados', categoria: 'configuracion', severidad: 'info' },
  'tenant.feature_flag_changed': { nombre: 'Función encendida o apagada', categoria: 'configuracion', severidad: 'info' },
  'user.created': { nombre: 'Usuario creado', categoria: 'usuarios', severidad: 'info' },
  'user.invited': { nombre: 'Usuario invitado', categoria: 'usuarios', severidad: 'info' },
  'user.deleted': { nombre: 'Usuario eliminado', categoria: 'usuarios', severidad: 'warning' },
  'user.login': { nombre: 'Inicio de sesión', categoria: 'acceso', severidad: 'info' },
  'user.failed_login': { nombre: 'Inicio de sesión fallido', categoria: 'acceso', severidad: 'warning' },
  'user.blocked': { nombre: 'Usuario bloqueado', categoria: 'usuarios', severidad: 'warning' },
  'user.unblocked': { nombre: 'Usuario desbloqueado', categoria: 'usuarios', severidad: 'info' },
  'user.role_changed': { nombre: 'Cambio de rol', categoria: 'usuarios', severidad: 'warning' },
  'billing.payment_succeeded': { nombre: 'Pago recibido', categoria: 'facturacion', severidad: 'info' },
  'billing.payment_failed': { nombre: 'Pago fallido', categoria: 'facturacion', severidad: 'error' },
  'billing.subscription_cancelled': { nombre: 'Suscripción cancelada', categoria: 'facturacion', severidad: 'warning' },
  'api_key.created': { nombre: 'Clave de API creada', categoria: 'seguridad', severidad: 'info' },
  'api_key.revoked': { nombre: 'Clave de API revocada', categoria: 'seguridad', severidad: 'info' },
  'data.exported': { nombre: 'Exportación de datos', categoria: 'datos', severidad: 'warning' },
  'data.sensitive_accessed': { nombre: 'Acceso a datos sensibles', categoria: 'datos', severidad: 'warning' },
  'support.impersonation_started': { nombre: 'Soporte entró como usuario', categoria: 'soporte', severidad: 'warning' },
  'support.impersonation_ended': { nombre: 'Soporte terminó de entrar como usuario', categoria: 'soporte', severidad: 'info' },
  'security.cross_tenant_access_attempt': { nombre: 'Intento de acceso a otro cliente', categoria: 'seguridad', severidad: 'critical' },
  'security.permission_denied': { nombre: 'Acción sin permiso', categoria: 'seguridad', severidad: 'warning' },
  'system.error': { nombre: 'Error de la aplicación', categoria: 'sistema', severidad: 'error' },
  'system.job_failed': { nombre: 'Tarea automática fallida', categoria: 'sistema', severidad: 'error' },
  'system.webhook_failed': { nombre: 'Webhook fallido', categoria: 'sistema', severidad: 'error' },
  'work_order.created': { nombre: 'Orden de trabajo creada', categoria: 'operacion', severidad: 'info' },
  'work_order.closed': { nombre: 'Orden de trabajo entregada', categoria: 'operacion', severidad: 'info' },
  'work_order.cancelled': { nombre: 'Orden de trabajo anulada', categoria: 'operacion', severidad: 'info' },
  'quote.sent': { nombre: 'Cotización enviada', categoria: 'operacion', severidad: 'info' },
  'quote.accepted': { nombre: 'Cotización aceptada', categoria: 'operacion', severidad: 'info' },
  'quote.rejected': { nombre: 'Cotización rechazada', categoria: 'operacion', severidad: 'info' },
} as const satisfies Record<string, Definicion>
export type TipoEvento = keyof typeof TIPOS_DE_EVENTO

export const tiposDeCategoria = (categoria: Categoria) =>
  (Object.keys(TIPOS_DE_EVENTO) as TipoEvento[]).filter((t) => TIPOS_DE_EVENTO[t].categoria === categoria)

/** La auditoría muestra lo que alguien hizo o lo que salió mal; los inicios de sesión y la operación diaria van aparte. */
export const CATEGORIAS_DE_AUDITORIA: Categoria[] = ['usuarios', 'configuracion', 'facturacion', 'seguridad', 'soporte', 'datos', 'sistema']
