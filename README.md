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
   - abajo, lo que **espera su máquina** (está detenida), lo que **espera repuestos**, lo que **espera su turno** y lo **detenido** con su motivo (falta la respuesta del cliente, está donde un tercero).

   El jefe de taller puede **adelantar** un trabajo, como armar el block mientras la culata sigue en su sección. La OT muestra **cómo va cada pieza**, lo que se contesta en el mesón: «la culata va en asientos con Pedro; el block espera los pistones».
   Cada trabajo tiene su **ficha**, que se abre al tocarlo en el tablero, en «Mis trabajos» o en la OT. Trae lo que el técnico necesita para hacerlo, sin montos:
   - la OT, el motor y su número, y la falla que trajo;
   - lo que le **indicó el jefe de taller** («rectificar a 0,50»);
   - **lo que ya se hizo en la misma pieza**, con lo que anotó cada uno (la medición, «muñones a 0,25»);
   - los repuestos que espera.

   Si le falta un repuesto, lo **pide desde la ficha**: queda por pedir en compras y el trabajo lo espera. No se termina sin él, aunque se haya empezado antes. Al terminar, anota la medida final o lo que encontró, y queda en la historia de la OT.
5. **Calidad y entrega.** Con todos los trabajos terminados, la OT pasa sola a control de calidad. El jefe de taller lo aprueba, queda lista y se entrega anotando quién la recibe.

El estado de una OT no se marca a mano: sale de sus trabajos y de su cotización (`estadoDeOt`). Tampoco la situación de cada trabajo (para hacer, espera su máquina, espera repuestos, espera su turno, detenido): sale de su pieza y su paso, de sus repuestos y de sus máquinas (`situacionDe`). Las dos están en `src/modulos/taller/reglas.ts`. Solo la aprobación de calidad, la entrega, la anulación, las detenciones y lo adelantado lo decide una persona.

**Actividades.** Cada rectificadora tiene su lista de actividades, ordenada por pieza. Cada actividad tiene:
- la pieza a la que se hace y su paso en la ruta;
- cómo se cuenta: por cilindro, válvula, biela o culata, o una vez;
- su valor y sus horas por unidad;
- si va en el desglose típico;
- quiénes la hacen (sus especialistas).

Por ejemplo, la prueba hidráulica de culata se cobra por cilindro: la culata más grande cuesta más. Al aprobarse una cotización, cada trabajo va solo a uno de sus especialistas. Va al que ya tiene esa pieza de la OT, si también hace la actividad; si no, al que tiene menos horas pendientes. Al reasignar una pieza, lo que sigue de ella en la sección va con ella. El administrador crea y ajusta las actividades. Quién hace cada una lo decide también el jefe de taller.

**Proveedores.** Cada rectificadora tiene su lista de proveedores: nombre, RUT (se revisa su dígito verificador), contacto, teléfono, correo, dónde se retira y una nota (qué vende, cómo se le paga). El proveedor se elige de la lista al cotizar un repuesto, al agregarlo a una OT y al emitir la orden de compra; si no está, se agrega ahí mismo. El mismo nombre no entra dos veces, aunque se escriba con otras mayúsculas, tildes o espacios. Un proveedor no se borra: se desactiva, deja de ofrecerse y sus órdenes quedan como están. Corregir su nombre lo corrige en sus órdenes y repuestos. La lista muestra cuántas órdenes tiene cada uno por retirar, cuántas van y la última. La agregan y corrigen el jefe de taller y el administrador; el técnico no la ve.

**Repuestos y compras.** Cada repuesto lleva su **medida** (STD, 0,25, 0,50…), su **marca** y su **número de parte** desde la cotización, para pedir el correcto. Lo que compra la rectificadora aparece en **Compras**, «por pedir», **agrupado por proveedor** (el que se cotizó), y dentro de cada uno, primero lo que la OT necesita antes: lo atrasado, lo urgente y lo que se entrega antes. «Pedir todo a…» abre la orden con ese proveedor ya elegido. El jefe de taller elige qué pedir y emite la **orden de compra** (OC-0001) a un proveedor de la lista, con el **chofer** que va a buscarlo: cualquier persona del taller, que ve sus retiros en el inicio (con la dirección del proveedor y su teléfono, que en el celular se marca con un toque) y los marca «recibido en el taller» al volver, todo o por partes si no llegó todo. Una orden sin nada recibido se anula con motivo y lo suyo vuelve a por pedir. Lo que trae el cliente se marca recibido cuando llega. Mientras un repuesto no llega, el trabajo que lo espera queda en **«espera repuestos»** (en el tablero, con lo que falta) y no se puede iniciar; al recibirlo, se libera solo. Si con la OT abierta aparece algo más (una bomba que se quebró al armar), se agrega a la OT. Cada OT muestra sus repuestos, quién los compra, si llegaron y en qué orden van; el técnico no ve costos ni proveedores.

**Bodega.** Los insumos del taller (aceite de prueba, pasta de esmeril, piedras de bruñir) tienen su unidad, su mínimo, su proveedor y su costo. Cualquiera que trabaje **saca** lo que usa, para una OT si se dice; el jefe de taller agrega insumos y **ajusta** al conteo con su motivo. Lo que queda en su mínimo aparece en Compras con lo que conviene pedir (hasta el doble del mínimo, descontando lo que viene en camino) y va en la misma orden de compra que los repuestos; al recibirse, entra a bodega. Cada movimiento queda anotado (`moverInsumo`).

**Máquinas.** Cada taller tiene su lista de máquinas, con las actividades que necesitan cada una (la lineadora, el lineado de bancada). Si una para, en falla o en mantención, sus trabajos quedan en **«máquina detenida»**: no se inician ni se adelantan hasta que vuelva a operar, y el tablero, la OT, la ficha y el inicio lo dicen solos. Cualquiera que trabaje avisa una falla; el jefe de taller la vuelve a operar. La **mantención** se lleva por días: cada cuánto, la última, la próxima y si está vencida. Al volver de una mantención, la próxima se cuenta desde ese día.

**Carga.** Por sección: su gente (los especialistas de sus actividades), las horas para hacer ahora, las que esperan su turno, lo detenido, lo sin asignar (que se reparte con un botón) y los días de cola. Por persona: lo que tiene cada uno.

**Roles dentro de cada rectificadora:**
- **Administrador:** todo, más la administración de la organización (su gente, dentro del límite del plan), las actividades con sus valores y las secciones.
- **Jefe de taller:** recibe, cotiza, elige quién hace cada actividad, asigna, indica, adelanta, pide y recibe repuestos e insumos, maneja las máquinas, aprueba calidad y entrega.
- **Técnico:** ve el taller y las OT, trabaja lo suyo, lo detiene si falta algo, pide el repuesto que le falta, saca insumos de bodega y avisa si una máquina falla; no ve cotizaciones, montos ni la lista de proveedores. Si es el chofer de compras, ve sus retiros (con dónde retirar) y recibe lo que trae.
- **Solo lectura:** mira todo y no cambia nada.

Cada rectificadora nace con las secciones y actividades de su **plantilla**, cada actividad con su pieza, su paso, su criterio y su valor, que después ajusta (`PLANTILLAS_TALLER`, en `src/modulos/taller/reglas.ts`):
- **Rectificadora completa:** 7 secciones y 29 actividades.
- **Taller de culatas:** recepción, culatas y terceros, con 9 actividades.
- **Block, cigüeñal y bielas:** sin culatas, con armado de medio motor y control final; 19 actividades.

También nace con las máquinas que sirven a sus actividades. Después, el administrador agrega, renombra, ordena (es el orden de las columnas del tablero) y apaga sus **secciones** desde Actividades. Una sección se apaga cuando no le quedan actividades en uso ni trabajos por hacer.

**Funciones por plan.** Tres módulos se encienden por cliente: **Compras y proveedores** (Free en adelante), **Bodega de insumos** (Starter en adelante) y **Máquinas y mantención** (Pro y Enterprise). La consola los enciende o apaga uno por uno. Apagado, su menú no aparece y el servidor no lo atiende: sin compras, los repuestos se agregan y se reciben en la OT; sin máquinas, una parada no frena trabajos.

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
- **Nueva rectificadora:** se da de alta con su nombre y subdominio (se propone desde el nombre), su región, su plan, si parte en prueba (con sus días) o activa (con el precio de lista o uno negociado), su correo de facturación, la plantilla de su taller y su primer administrador. Pide el permiso «Dar de alta clientes nuevos» y un motivo; queda en su auditoría con el después. El subdominio no se repite ni toma los de la plataforma (`www`, `api`, `admin`…).
- **Ficha de cada cliente:** general, usuarios, actividad, uso, facturación, seguridad y auditoría, más «Abrir su sistema», que entra como su administrador con motivo y registro. En usuarios, «Agregar persona» (con su permiso y motivo).
- **Alertas, ingresos y actividad, y auditoría.**

**Su gente.** Desde que nace, el administrador de cada rectificadora agrega a su gente en su panel («Usuarios y roles»): nombre, correo y rol. A un técnico nuevo se le dan después sus actividades, y desde ahí le llegan sus trabajos. Un correo no se repite dentro de una organización, pero la misma persona puede estar en dos. Las cuentas nacen activas mientras no haya inicio de sesión real.

El **uso** que mide la consola (OT del mes contra el límite del plan, cotizaciones, documentos y llamadas a la API) sale del trabajo real de cada rectificadora: cada pedido a su sistema suma una llamada y cada OT o cotización suma lo suyo (`sumarUso` en `src/modulos/taller/comun.ts`). Dos límites se cumplen: si una rectificadora llega al de OT del mes, la recepción se lo avisa; si llega al de usuarios, no se agrega a nadie más hasta ampliar el plan o el límite (cuenta quien tiene cuenta, activo o bloqueado). El almacenamiento y las llamadas a la API se miden, pero todavía no frenan nada. Las operaciones (OT recibidas, entregadas o anuladas, y cotizaciones enviadas, aceptadas o rechazadas) aparecen en su actividad y su auditoría.

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

El equipo de la plataforma vive en su propia tabla y es el único perfil con acceso global. Cada acción sensible pide su permiso y un motivo, y queda en la auditoría con antes y después. Al **impersonar** queda registrado quién, a qué cliente, como quién, inicio, fin, motivo e IP. Vence en una hora, y lo hecho dentro queda a nombre de la persona del equipo. Lo prueban `acceso/aislamiento.test.ts`, `plataforma/acciones.test.ts`, `plataforma/alta.test.ts`, `taller/rutas.test.ts` y `compras/rutas.test.ts`.

## Cómo está hecho

El stack es el mismo de ERP Nuevo: TypeScript, Hono dentro de Vite, React + Ant Design, TanStack Router y Query, Drizzle sobre PostgreSQL (PGlite en desarrollo y pruebas), Zod y Vitest. Módulos en `src/modulos/`:

| Módulo | Contenido |
|---|---|
| `taller` | Secciones, actividades, OT y sus trabajos, el reparto (ruta por pieza, especialistas, detenciones, carga) y el tablero |
| `comercial` | Clientes y cotizaciones |
| `compras` | Proveedores, repuestos de cada OT, órdenes de compra con su chofer y recepción, y la bodega de insumos |
| `maquinas` | Máquinas, sus actividades, paradas y mantención |
| `organizacion` | Panel del administrador de cada rectificadora |
| `plataforma` | Consola |
| `acceso` | Identidad, guardias y permisos |
| `eventos` | Auditoría |
| `salud` y `alertas` | Reglas de salud y alertas |
| `demo` | La siembra |

## Qué falta

- **Inicio de sesión real.** Hoy se entra con «Entrar como» (cookie sin firma, solo desarrollo). Para producción hay que pasar a `crearApp` una `Identidad` que lea la sesión firmada (`src/modulos/acceso/identidad.ts`). Con eso, las personas nuevas deben nacer invitadas, recibir su correo y quedar activas al entrar la primera vez (hoy nacen activas, en `agregarPersona`).
- **Cobro real.** Las facturas y los eventos de pago son de demostración; deben venir del procesador de pagos.
- **Del taller, para la siguiente vuelta:**
  - PDF de la cotización y del acta de entrega, y envío por correo;
  - fotos del diagnóstico, y las mediciones como datos (hoy se anotan como texto en la ficha);
  - horas reales con reloj (para comparar con las estándar y afinar la cola);
  - fecha de entrega sugerida según la cola de cada sección y los repuestos;
  - la orden de compra impresa o enviada al proveedor y el costo real contra el cotizado (con eso, cuánto se le compra a cada proveedor);
  - stock de repuestos (lo que sobra para la próxima OT; hoy la bodega es solo de insumos);
  - piezas propias de cada taller (hoy son fijas: motor, culata, block, cigüeñal, bielas, árbol de levas y otra), para talleres de bombas inyectoras o turbos;
  - días de gracia en la salud de un cliente recién creado (hoy aparece «en riesgo» porque nadie ha entrado todavía);
  - portal para los clientes de cada rectificadora;
  - facturación al cliente final.
- **Zona horaria.** Los días se agrupan en UTC.
- **Escala.** El panorama de clientes se calcula en cada pedido; anda bien con miles de clientes.
