# Rectificadora — SaaS para rectificadoras

Un sistema para rectificadoras de motores, al estilo del ERP de Baufer, que se ofrece a muchas rectificadoras a la vez (multicliente). Cada rectificadora tiene **su propio sistema**: recibe motores, cotiza con sus actividades valorizadas, reparte el trabajo por pieza entre sus especialistas, compra los repuestos y sigue cada orden hasta la entrega. Nadie ve los datos de otra. Por encima, **la consola de la plataforma** deja al equipo interno administrar a todos los clientes: uso, salud, cobros, seguridad y soporte.

Estado (13-11-2026): **MVP completo con datos de demostración.** Falta conectar el inicio de sesión real y el cobro real (ver «Qué falta»).

## Las tres partes

| Parte | Dirección | Para quién |
|---|---|---|
| **Sistema de la rectificadora** | `/c/<cliente>` (en producción, `<cliente>.<dominio>`) | La gente de cada rectificadora: jefe de taller, técnicos, administración |
| **Administración de la organización** | `/organizacion` | El administrador de cada rectificadora: usuarios, plan, facturación, seguridad, auditoría |
| **Consola de la plataforma** | `/plataforma` | El equipo interno (super-admin): todos los clientes |

## Cómo trabaja una rectificadora en el sistema

1. **Recepción.** Llega un motor completo o piezas (culata, block, cigüeñal, bielas). Se anota el cliente, el motor y su número, sus cilindros, válvulas por cilindro y culatas, el equipo y su patente, la falla y la entrega comprometida. Nace la **OT** (OT-0001, correlativa por rectificadora) con su diagnóstico: desarme, lavado y medición si viene el motor o el block; prueba de fisuras (y la hidráulica, si viene la culata) si son piezas sueltas.
2. **Diagnóstico y cotización.** Con lo que se midió se arma la **cotización** con las **actividades** del taller. Cada una se cuenta sola con los datos del motor: el rectificado de cilindros de un motor de 6 cilindros va por 6, el de asientos de 24 válvulas va por 24. Si se cambian los cilindros, se recuenta todo. **Desglose por pieza** trae lo típico de cada pieza (culata, block, cigüeñal, bielas, y el desarme, armado y control del motor completo), y quien cotiza quita lo que no corresponde. Se suman repuestos y otros cargos, descuento e IVA 19 %. Cada repuesto dice **quién lo compra**: la rectificadora (a un proveedor de su lista y a un costo, que el cliente no ve) o el cliente, que lo trae y no se le cobra; y **qué trabajo lo espera** (el armado, si no se dice otro). Un trabajo de terceros (nitrurado, soldadura) se cotiza con precio a mano y no se envía sin él.
3. **Aprobación.** Enviada, la OT queda «esperando aprobación». Si el cliente acepta, cada actividad cotizada pasa a la OT como un trabajo: a **su sección**, a la **ruta de su pieza** y a **uno de sus especialistas**. Lo que ya se hizo en el diagnóstico se cobra, pero no se repite. Los repuestos quedan en la OT: por pedir (los compra la rectificadora) o por llegar (los trae el cliente). Si rechaza, la OT se anula o se recotiza. También se puede cotizar sin OT; al aceptar, nace la OT.
4. **Taller.** Desarmado, el motor deja de ser una sola cosa. Cada pieza sigue su ruta, un paso tras otro (en la culata: cepillado, guías, asientos, válvulas, armado de culata), y las piezas avanzan a la vez. El armado y el control final esperan a todas. El **tablero** tiene una columna por sección:
   - arriba, lo que se puede hacer ahora: primero lo en proceso, después lo atrasado, lo urgente y lo que vence antes;
   - abajo, lo que **espera su turno** y lo **detenido** con su motivo (faltan repuestos, falta la respuesta del cliente, está donde un tercero).

   El jefe de taller puede **adelantar** un trabajo, como armar el block mientras la culata sigue en su sección. La OT muestra **cómo va cada pieza**, lo que se contesta en el mesón: «la culata va en asientos con Pedro; el block espera los pistones».
5. **Calidad y entrega.** Con todos los trabajos terminados, la OT pasa sola a control de calidad. El jefe de taller lo aprueba, queda lista y se entrega anotando quién la recibe.

El estado de una OT no se marca a mano: sale de sus trabajos y de su cotización (`estadoDeOt`). Tampoco la situación de cada trabajo (para hacer, espera su turno, detenido): sale de su pieza y su paso (`situacionDe`). Las dos están en `src/modulos/taller/reglas.ts`. Solo la aprobación de calidad, la entrega, la anulación, las detenciones y lo adelantado lo decide una persona.

**Actividades.** Cada rectificadora tiene su lista de actividades, ordenada por pieza. Cada actividad tiene:
- la pieza a la que se hace y su paso en la ruta;
- cómo se cuenta: por cilindro, válvula, biela o culata, o una vez;
- su valor y sus horas por unidad;
- si va en el desglose típico;
- quiénes la hacen (sus especialistas).

Por ejemplo, la prueba hidráulica de culata se cobra por cilindro: la culata más grande cuesta más. Al aprobarse una cotización, cada trabajo va solo a uno de sus especialistas. Va al que ya tiene esa pieza de la OT, si también hace la actividad; si no, al que tiene menos horas pendientes. Al reasignar una pieza, lo que sigue de ella en la sección va con ella. El administrador crea y ajusta las actividades. Quién hace cada una lo decide también el jefe de taller.

**Proveedores.** Cada rectificadora tiene su lista de proveedores: nombre, RUT (se revisa su dígito verificador), contacto, teléfono, correo, dónde se retira y una nota (qué vende, cómo se le paga). El proveedor se elige de la lista al cotizar un repuesto, al agregarlo a una OT y al emitir la orden de compra; si no está, se agrega ahí mismo. El mismo nombre no entra dos veces, aunque se escriba con otras mayúsculas, tildes o espacios. Un proveedor no se borra: se desactiva, deja de ofrecerse y sus órdenes quedan como están. Corregir su nombre lo corrige en sus órdenes y repuestos. La lista muestra cuántas órdenes tiene cada uno por retirar, cuántas van y la última. La agregan y corrigen el jefe de taller y el administrador; el técnico no la ve.

**Repuestos y compras.** Lo que compra la rectificadora aparece en **Compras**, «por pedir», con el proveedor que se cotizó. El jefe de taller elige qué pedir y emite la **orden de compra** (OC-0001) a un proveedor de la lista, con el **chofer** que va a buscarlo: cualquier persona del taller, que ve sus retiros en el inicio (con la dirección del proveedor y su teléfono, que en el celular se marca con un toque) y los marca «recibido en el taller» al volver, todo o por partes si no llegó todo. Una orden sin nada recibido se anula con motivo y lo suyo vuelve a por pedir. Lo que trae el cliente se marca recibido cuando llega. Mientras un repuesto no llega, el trabajo que lo espera queda en **«espera repuestos»** (en el tablero, con lo que falta) y no se puede iniciar; al recibirlo, se libera solo. Si con la OT abierta aparece algo más (una bomba que se quebró al armar), se agrega a la OT. Cada OT muestra sus repuestos, quién los compra, si llegaron y en qué orden van; el técnico no ve costos ni proveedores.

**Carga.** Por sección: su gente (los especialistas de sus actividades), las horas para hacer ahora, las que esperan su turno, lo detenido, lo sin asignar (que se reparte con un botón) y los días de cola. Por persona: lo que tiene cada uno.

**Roles dentro de cada rectificadora:**
- **Administrador:** todo, más la administración de la organización y las actividades con sus valores.
- **Jefe de taller:** recibe, cotiza, elige quién hace cada actividad, asigna, adelanta, pide y recibe repuestos, aprueba calidad y entrega.
- **Técnico:** ve el taller y las OT, trabaja lo suyo y lo detiene si falta algo; no ve cotizaciones, montos ni la lista de proveedores. Si es el chofer de compras, ve sus retiros (con dónde retirar) y recibe lo que trae.
- **Solo lectura:** mira todo y no cambia nada.

Cada rectificadora nace con 7 secciones y 29 actividades con su pieza, su paso, su criterio y su valor (`SECCIONES_INICIALES` y `TRABAJOS_INICIALES`), que después ajusta.

## Cómo se corre

Requiere Node.js 24 o superior.

```bash
npm install
npm run dev
```

Se abre en http://localhost:5180. La primera vez crea la base en `.datos/desarrollo` (PGlite) y siembra la demostración: 30 rectificadoras ficticias, unas 400 personas con sus oficios (desarmador, culatero, el del block, el de cigüeñales, armador) y unas 2.000 OT en 90 días, con sus cotizaciones contadas por cilindro, sus trabajos en la ruta de cada pieza, sus proveedores, sus repuestos (pedidos a un proveedor en órdenes de compra que el chofer va a buscar, o traídos por el cliente) y algunos trabajos detenidos o esperando repuestos. Siembra en unos 4 segundos. En «Entrar como» (solo en desarrollo) se elige a alguien del equipo, o una rectificadora y una persona de cada rol.

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
2. Todo lo que el pedido nombra por id (una OT, una tarea, un cliente, una cotización, un repuesto, un proveedor, una orden de compra, un usuario) se busca dentro de ese tenant (`filaDelTenant` o, si son varios, `filasDelTenant`).
3. Estos intentos se rechazan y quedan como evento crítico `security.cross_tenant_access_attempt`, con su alerta:
   - nombrar algo de otra rectificadora;
   - abrir el portal de otra (`/c/<otra>`, que viaja en `x-portal`);
   - elegir otro tenant por encabezado o por la dirección;
   - que alguien de una rectificadora pida la consola global.

El equipo de la plataforma vive en su propia tabla y es el único perfil con acceso global. Cada acción sensible pide su permiso y un motivo, y queda en la auditoría con antes y después. Al **impersonar** queda registrado quién, a qué cliente, como quién, inicio, fin, motivo e IP. Vence en una hora, y lo hecho dentro queda a nombre de la persona del equipo. Lo prueban `acceso/aislamiento.test.ts`, `plataforma/acciones.test.ts`, `taller/rutas.test.ts` y `compras/rutas.test.ts`.

## Cómo está hecho

El stack es el mismo de ERP Nuevo: TypeScript, Hono dentro de Vite, React + Ant Design, TanStack Router y Query, Drizzle sobre PostgreSQL (PGlite en desarrollo y pruebas), Zod y Vitest. Módulos en `src/modulos/`:

| Módulo | Contenido |
|---|---|
| `taller` | Secciones, actividades, OT y sus trabajos, el reparto (ruta por pieza, especialistas, detenciones, carga) y el tablero |
| `comercial` | Clientes y cotizaciones |
| `compras` | Proveedores, repuestos de cada OT, órdenes de compra con su chofer y recepción |
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
  - horas reales con reloj (para comparar con las estándar y afinar la cola);
  - fecha de entrega sugerida según la cola de cada sección y los repuestos;
  - la orden de compra impresa o enviada al proveedor y el costo real contra el cotizado (con eso, cuánto se le compra a cada proveedor);
  - bodega de repuestos (lo que queda en stock para la próxima OT);
  - portal para los clientes de cada rectificadora;
  - facturación al cliente final.
- **Zona horaria.** Los días se agrupan en UTC.
- **Escala.** El panorama de clientes se calcula en cada pedido; anda bien con miles de clientes.
