# Rectificadora — consola de la plataforma

Administración del SaaS multitenant para rectificadoras. Dos pantallas para dos públicos que nunca se mezclan:

- **Consola de la plataforma** (`/plataforma`): para el equipo interno (super-admin). Ve a todos los clientes: el estado del negocio, quién usa el producto, quién dejó de entrar, quién no paga, quién está cerca de sus límites, dónde hay errores y si hay actividad sospechosa. Desde aquí se suspende, reactiva, cambia de plan, ajustan límites, encienden funciones, bloquean usuarios y se entra como el administrador de un cliente (con motivo y registro).
- **Panel de la organización** (`/organizacion`): para el administrador de cada cliente. Solo su organización: usuarios y roles, últimos ingresos, invitaciones, uso del plan, facturación, integraciones, seguridad y su auditoría.

Estado (11-11-2026): **MVP completo con datos de demostración.** Falta conectarlo al inicio de sesión real del portal y a las fuentes reales (ver «Qué falta»).

## Cómo se corre

Requiere Node.js 24 o superior.

```bash
npm install
npm run dev
```

Se abre en http://localhost:5180. La primera vez crea la base en `.datos/desarrollo` (PGlite, PostgreSQL dentro de la app) y siembra la demostración: 30 rectificadoras ficticias, ~400 usuarios, 90 días de ingresos, facturas, uso y eventos. En la pantalla de entrada, «Entrar como» deja elegir a cualquiera sin clave (solo existe en desarrollo):

| Persona | Para probar |
|---|---|
| Valentina Rojas | Equipo, todos los permisos |
| Matías Soto | Equipo, solo bloquear usuarios e impersonar |
| Camila Fuentes | Equipo, solo cambiar plan y estado |
| Un administrador de cualquier cliente | El panel de su organización |
| Un usuario común | Ve que no tiene acceso a nada de esto |

- `npm test`: pruebas (Vitest, cada una con su base en memoria).
- `npm run tipos`: TypeScript.
- `npm run demo:reiniciar`: borra la base de desarrollo; la próxima vez que arranque se siembra de nuevo con fechas al día.
- `npm run migracion`: genera la migración después de cambiar una tabla.

## Qué hay

**Resumen** — clientes activos, en prueba, suspendidos o cancelados; MRR y MRR en riesgo; pagos vencidos o fallidos; usuarios registrados y activos en 24 h, 7 y 30 días; ingresos y fallidos; errores críticos; alertas por prioridad; los clientes que necesitan atención; ingresos por día; errores recientes. Cada cifra lleva a la lista que la explica.

**Clientes** — la tabla de todos, con ID, estado, plan, usuarios activos y totales, último ingreso, creación, uso del plan, pago, MRR, salud y alertas. Filtra por estado, plan, pago, salud, nivel de uso, última actividad, fecha de creación y búsqueda por nombre, correo (también de sus usuarios) o ID, sin importar tildes. Ordena por último ingreso, usuarios, creación, MRR, estado, uso y salud. Los filtros viajan en la dirección: una vista filtrada se comparte con el enlace.

**Ficha del cliente** — General (datos, subdominio, región, límites, funciones, salud con sus factores, accesos de soporte), Usuarios, Actividad (por día, semana o mes; ingresos, fallidos, acciones importantes, operaciones, usuarios sin actividad), Uso, Facturación, Seguridad (IPs, países, MFA, SSO, claves de API, cambios de rol, eventos sensibles) y Auditoría.

**Alertas** — sin actividad 14/30 días o nunca, pago fallido o vencido, prueba por vencer o vencida, uso sobre 80/90 %, muchos ingresos fallidos, error crítico, webhook fallando, tarea automática fallida, consumo de API anormal (más del triple de la mediana) e intento de acceso a otro cliente. Prioridad crítica, alta, media o baja. Se calculan con los datos de ahora: desaparecen solas cuando el problema se resuelve. Reglas en `src/modulos/alertas/reglas.ts`.

**Ingresos y actividad** — ingresos 24 h / 7 / 30 días, fallidos, ráfagas de fallidos por cuenta (5+) o por IP (10+), clientes sin actividad en X días, usuarios sin actividad, y el último ingreso de cualquier persona.

**Auditoría** — todos los eventos, filtrables por categoría, tipo, cliente, severidad y fechas; cada uno se abre con sus datos completos.

## Seguridad multitenant

1. El panel del cliente toma el tenant **solo** de la sesión de quien pide, nunca del pedido. Todas sus consultas filtran por ese `tenant_id`.
2. Todo lo que el pedido nombra por id (un usuario) se busca dentro de ese tenant.
3. Si lo nombrado es de otro cliente, se responde «no existe»; si alguien de un cliente pide la consola global, o intenta elegir otro tenant por encabezado o dirección, se responde «sin permiso». En los tres casos queda un evento crítico `security.cross_tenant_access_attempt`, que además dispara su alerta.

El equipo de la plataforma vive en su propia tabla (`platform_admins`), aparte de las personas de los clientes: es el único perfil con acceso global. Ser del equipo da lectura; cada acción sensible pide su permiso (`src/modulos/acceso/permisos.ts`) y un motivo, y la negativa también se anota. Ver IPs completas pide el permiso de datos sensibles y queda anotado. El panel del cliente no recibe nada interno de la plataforma (salud, alertas).

**Impersonación**: solo con el permiso, si el cliente lo permite y como un administrador activo. Queda en `impersonations` quién entró, a qué cliente, como quién, inicio, fin, motivo e IP; vence sola en una hora. Lo que se haga dentro queda a nombre de la persona del equipo, no del administrador. El cliente lo ve en su auditoría.

Lo prueban `src/modulos/acceso/aislamiento.test.ts` y `src/modulos/plataforma/acciones.test.ts`.

## Modelo de eventos

Un solo registro, `events`, que solo se agrega: `id, tenant_id, actor_id, actor_type, user_id, event_type, severity, target_id, target_type, metadata, ip_address, user_agent, created_at`. Los tipos (los de la especificación más `tenant.cancelled`, `tenant.limits_changed`, `tenant.feature_flag_changed`, `user.deleted`, `data.sensitive_accessed`, `security.permission_denied`, `system.error` y los de operación) están en `src/modulos/eventos/tipos.ts`. Cada cambio anota su evento en la misma transacción: si el cambio no entra, el evento tampoco. Un error no previsto de la API queda como `system.error`.

## Salud del cliente

Puntaje de 0 a 100 con seis factores: frecuencia de ingreso (25), usuarios activos (20), uso de funciones clave (15), pagos al día (20), errores recientes (10) y holgura en los límites (10). Sano desde 75, atención desde 55, en riesgo desde 35, crítico bajo eso; un pago fallido sin ingresos hace dos semanas es crítico siempre. Ya acepta incidentes de soporte (`incidentesAbiertos`) para cuando exista la integración. Reglas en `src/modulos/salud/reglas.ts`.

## Cómo está hecho

Mismo stack que ERP Nuevo: TypeScript, Hono (API) dentro de Vite, React + Ant Design, TanStack Router y Query, Drizzle sobre PostgreSQL (PGlite en desarrollo y pruebas), Zod, Vitest. Cada módulo vive en `src/modulos/<modulo>/` con sus tablas, reglas, rutas y pantallas.

## Qué falta

- **Inicio de sesión real.** Hoy se entra con «Entrar como» (cookie sin firma, solo desarrollo). Para producción hay que pasar a `crearApp` una `Identidad` que lea la sesión firmada del portal (`src/modulos/acceso/identidad.ts`); el resto no cambia. No hay todavía un arranque de producción (`produccion.ts`) a propósito, para no publicarlo sin eso.
- **Datos reales.** Los ingresos (`user.login`, `user.failed_login`), el uso diario (`usage_daily`), las facturas y los eventos de cobro hoy son de demostración. El producto y el procesador de pagos tienen que escribirlos (lo de pagos, por webhook del procesador).
- **Zona horaria.** Los días se agrupan en UTC.
- **Escala.** El panorama de clientes se calcula en cada pedido con cuatro consultas agrupadas; anda bien con miles de clientes. Más allá, conviene guardarlo calculado cada pocos minutos.
- **Segunda fase** (fuera del MVP, como pide la especificación): salud avanzada con tendencia, gráficos complejos, predicción de abandono, cohortes, reportes exportables, avisos automáticos de alertas por correo.
