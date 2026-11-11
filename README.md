# Rectificadora — SaaS para rectificadoras

Un sistema para rectificadoras de motores, al estilo del ERP de Baufer, que se ofrece a muchas rectificadoras a la vez (multicliente). Cada rectificadora tiene **su propio sistema**: recibe motores, cotiza, reparte los trabajos por sección y sigue cada orden hasta la entrega. Nadie ve los datos de otra. Por encima, **la consola de la plataforma** deja al equipo interno administrar a todos los clientes: uso, salud, cobros, seguridad y soporte.

Estado (11-11-2026): **MVP completo con datos de demostración.** Falta conectar el inicio de sesión real y el cobro real (ver «Qué falta»).

## Las tres partes

| Parte | Dirección | Para quién |
|---|---|---|
| **Sistema de la rectificadora** | `/c/<cliente>` (en producción, `<cliente>.<dominio>`) | La gente de cada rectificadora: jefe de taller, técnicos, administración |
| **Administración de la organización** | `/organizacion` | El administrador de cada rectificadora: usuarios, plan, facturación, seguridad, auditoría |
| **Consola de la plataforma** | `/plataforma` | El equipo interno (super-admin): todos los clientes |

## Cómo trabaja una rectificadora en el sistema

1. **Recepción.** Llega un motor completo o piezas (culata, block, cigüeñal, bielas). Se anota el cliente, el motor y su número, el equipo y su patente, la falla y la entrega comprometida. Nace la **OT** (OT-0001, correlativa por rectificadora) con su desarme, lavado y medición en la sección de diagnóstico.
2. **Diagnóstico y cotización.** Con lo que se midió se arma la **cotización** con la lista de trabajos con precio del taller (cepillado de culata, rectificado de cilindros por cilindro, rectificado de cigüeñal, armado…), repuestos y otros cargos, descuento e IVA 19 %. Un trabajo de terceros (nitrurado, soldadura) se cotiza con precio a mano y no se envía sin él.
3. **Aprobación.** Enviada, la OT queda «esperando aprobación». Si el cliente acepta, cada trabajo cotizado pasa a **su sección** como una tarea. Si rechaza, la OT se anula o se recotiza. También se puede cotizar sin OT; al aceptar, nace la OT.
4. **Taller.** El **tablero** muestra una columna por sección (recepción y diagnóstico, culatas, block, cigüeñal y bielas, armado, control de calidad y terceros) con lo que falta hacer: primero lo que está en proceso, después lo urgente y lo que vence antes. El jefe de taller asigna; el técnico inicia y termina. La OT muestra su **avance** (por horas estándar), si va **atrasada** o **por vencer**, y su historia.
5. **Calidad y entrega.** Con todos los trabajos terminados, la OT pasa sola a control de calidad. El jefe de taller lo aprueba, queda lista y se entrega anotando quién la recibe.

El estado de una OT no se marca a mano: sale de sus tareas y de su cotización (`estadoDeOt` en `src/modulos/taller/reglas.ts`). Solo la aprobación de calidad, la entrega y la anulación las decide una persona.

**Roles dentro de cada rectificadora:**
- **Administrador:** todo, más la administración de la organización y la lista de precios.
- **Jefe de taller:** recibe, cotiza, asigna, aprueba calidad y entrega.
- **Técnico:** ve el taller y las OT y trabaja lo suyo; no ve cotizaciones ni montos.
- **Solo lectura:** mira todo y no cambia nada.

Cada rectificadora nace con 7 secciones y 29 trabajos con precio (`SECCIONES_INICIALES` y `TRABAJOS_INICIALES`), que después ajusta.

## Cómo se corre

Requiere Node.js 24 o superior.

```bash
npm install
npm run dev
```

Se abre en http://localhost:5180. La primera vez crea la base en `.datos/desarrollo` (PGlite) y siembra la demostración: 30 rectificadoras ficticias, unas 400 personas y unas 2.000 OT en 90 días, con sus cotizaciones y sus trabajos por sección. Siembra en unos 4 segundos. En «Entrar como» (solo en desarrollo) se elige a alguien del equipo, o una rectificadora y una persona de cada rol.

- `npm test`: pruebas (Vitest, cada una con su base en memoria).
- `npm run tipos`: TypeScript.
- `npm run demo:reiniciar`: borra la base de desarrollo; al arrancar se siembra de nuevo con fechas al día.
- `npm run migracion`: genera la migración después de cambiar una tabla.

## La consola de la plataforma

- **Resumen:** clientes por estado, MRR, pagos vencidos o fallidos, usuarios activos, ingresos y fallidos, errores críticos, alertas y clientes en riesgo.
- **Clientes:** tabla con filtros y orden. Los filtros viajan en la dirección.
- **Ficha de cada cliente:** general, usuarios, actividad, uso, facturación, seguridad y auditoría, más «Abrir su sistema», que entra como su administrador con motivo y registro.
- **Alertas, ingresos y actividad, y auditoría.**

El **uso** que mide la consola (OT del mes contra el límite del plan, cotizaciones, documentos y llamadas a la API) sale del trabajo real de cada rectificadora: cada pedido a su sistema suma una llamada y cada OT o cotización suma lo suyo (`sumarUso` en `src/modulos/taller/comun.ts`). Si una rectificadora llega al límite de OT de su plan, la recepción se lo avisa. Las operaciones (OT recibidas, entregadas o anuladas, y cotizaciones enviadas, aceptadas o rechazadas) aparecen en su actividad y su auditoría.

**Alertas:** sin actividad 14/30 días o nunca, pago fallido o vencido, prueba por vencer, uso sobre 80/90 %, muchos ingresos fallidos, error crítico, webhook o tarea fallando, consumo de API anormal e intento de acceso a otro cliente. Se calculan con los datos de ahora (`src/modulos/alertas/reglas.ts`).

**Salud del cliente:** de 0 a 100, con seis factores: frecuencia de ingreso, usuarios activos, uso de funciones clave, pagos, errores y holgura en los límites (`src/modulos/salud/reglas.ts`).

## Seguridad multicliente

1. El sistema y la administración de cada rectificadora toman el tenant **solo** de la sesión. Todas sus consultas filtran por ese `tenant_id`.
2. Todo lo que el pedido nombra por id (una OT, una tarea, un cliente, una cotización, un usuario) se busca dentro de ese tenant (`filaDelTenant`).
3. Estos intentos se rechazan y quedan como evento crítico `security.cross_tenant_access_attempt`, con su alerta:
   - nombrar algo de otra rectificadora;
   - abrir el portal de otra (`/c/<otra>`, que viaja en `x-portal`);
   - elegir otro tenant por encabezado o por la dirección;
   - que alguien de una rectificadora pida la consola global.

El equipo de la plataforma vive en su propia tabla y es el único perfil con acceso global. Cada acción sensible pide su permiso y un motivo, y queda en la auditoría con antes y después. Al **impersonar** queda registrado quién, a qué cliente, como quién, inicio, fin, motivo e IP. Vence en una hora, y lo hecho dentro queda a nombre de la persona del equipo. Lo prueban `acceso/aislamiento.test.ts`, `plataforma/acciones.test.ts` y `taller/rutas.test.ts`.

## Cómo está hecho

El stack es el mismo de ERP Nuevo: TypeScript, Hono dentro de Vite, React + Ant Design, TanStack Router y Query, Drizzle sobre PostgreSQL (PGlite en desarrollo y pruebas), Zod y Vitest. Módulos en `src/modulos/`:

| Módulo | Contenido |
|---|---|
| `taller` | Secciones, lista de trabajos, OT, tareas y tablero |
| `comercial` | Clientes y cotizaciones |
| `organizacion` | Panel del administrador de cada rectificadora |
| `plataforma` | Consola |
| `acceso` | Identidad, guardias y permisos |
| `eventos` | Auditoría |
| `salud` y `alertas` | Reglas de salud y alertas |
| `demo` | La siembra |

## Qué falta

- **Inicio de sesión real.** Hoy se entra con «Entrar como» (cookie sin firma, solo desarrollo). Para producción hay que pasar a `crearApp` una `Identidad` que lea la sesión firmada (`src/modulos/acceso/identidad.ts`). Tampoco hay invitaciones ni alta de rectificadoras nuevas desde la pantalla. `tallerInicial` ya arma su taller.
- **Cobro real.** Las facturas y los eventos de pago son de demostración; deben venir del procesador de pagos.
- **Del taller, para la siguiente vuelta:**
  - PDF de la cotización y del acta de entrega, y envío por correo;
  - fotos y mediciones del diagnóstico;
  - especialidades por técnico, para sugerir a quién asignar;
  - horas reales con reloj;
  - repuestos y compras;
  - portal para los clientes de cada rectificadora;
  - facturación al cliente final.
- **Zona horaria.** Los días se agrupan en UTC.
- **Escala.** El panorama de clientes se calcula en cada pedido; anda bien con miles de clientes.
