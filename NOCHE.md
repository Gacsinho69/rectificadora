# Mejoras de la noche

Rama local `mejoras-nocturnas` (sale de `main` en `a4dd7a3`). Nada subido a GitHub. Cada vuelta: agentes Haiku buscan,
otro agente Haiku intenta desmentir, reviso en el código, arreglo lo confirmado con su prueba, `npm test` y
`npm run tipos`, y commit local.

## Áreas

- [x] Acceso: sesiones, claves, invitaciones y guardias (vuelta 1)
- [x] Taller: reparto, situación y bloqueos (vuelta 2)
- [x] Cotizaciones y clientes (vuelta 3)
- [x] Compras, proveedores y bodega (vuelta 4)
- [x] Máquinas (vuelta 5)
- [x] Consola de la plataforma: acciones, panorama, alertas y salud (vuelta 6)
- [x] Panel de la organización y alta de personas (vuelta 7)
- [x] Pantallas del taller (vuelta 8)
- [x] Pantallas de compras, organización y consola (vuelta 9, a medias: ver abajo)
- [ ] Producción: servidor, encabezados y contenedor

## En pausa

Las vueltas quedaron en pausa a pedido de la sesión «Monitoreo de sesiones activas», para cuidar el cupo semanal
(prioridad: el sitio web). Se termina la vuelta 9 y no se lanza la 10 (Producción) hasta que el dueño diga que sigan.

## Para la mañana

- **Recuperar la clave olvidada.** La pantalla de entrar dice «pide al administrador un enlace nuevo», pero el
  administrador solo puede mandar enlaces a quien todavía no entra. Una persona activa que olvida su clave hoy no
  tiene cómo volver. Hay que decidir el camino: un botón «Mandar enlace para cambiar la clave» en el panel del
  administrador, un correo automático, o que lo haga soporte. (Vuelta 1)
- **La IP que queda en la auditoría.** Se toma la primera del encabezado `x-forwarded-for`. Si el proveedor donde se
  publique agrega la IP al final en vez de reemplazar el encabezado, alguien puede inventar la suya. Depende de dónde
  se publique: cuando se elija el proveedor, se ajusta a cómo lo manda. (Vuelta 1)

- **Proveedor escrito a mano en una cotización.** El servidor todavía acepta un repuesto cotizado con el proveedor
  escrito como texto, sin elegirlo de la lista (así venían las cotizaciones de antes de la lista). La pantalla siempre
  lo elige de la lista, así que hoy no pasa. Si se quiere cerrar del todo, hay que decidir qué hacer con las
  cotizaciones viejas que lo traen escrito. (Vuelta 3)
- **Otra sesión usó esta carpeta.** Cerca de las 04:40 había un servidor de prueba de otra sesión corriendo aquí
  (puerto 5182, con `.claude/revision.env`). No lo toqué, y por eso en las vueltas 3 a 7 no abrí el sistema en el
  navegador. En la vuelta 8 ya no estaba y volví a usar el mío. (Vuelta 3)
- **Dos máquinas para la misma actividad.** Si el taller tiene dos lineadoras y una se detiene, hoy todos los trabajos
  de lineado quedan «esperando su máquina», aunque la otra esté operando. ¿Debería bloquear solo cuando estén
  detenidas todas las máquinas de esa actividad? (Vuelta 5)
- **El uso de máquinas y bodega en la consola.** La regla dice que lo que hace una rectificadora suma a su uso, pero
  detener máquinas, anotar mantenciones o mover la bodega no suma nada: la consola no ve si un cliente usa esos
  módulos. Hay que decidir qué se cuenta (y si «Máquinas» va como uso aparte). (Vuelta 5)
- **El motivo que escribe el equipo, ¿lo ve el cliente?** Cuando el equipo suspende a un cliente, le cambia el plan o
  los límites, o bloquea a alguien, el motivo que escribe queda en la auditoría del cliente («Tres cobros fallidos sin
  respuesta»). La pantalla de «Entrar como» dice a propósito que el cliente ve ese motivo; para lo demás no hay una
  regla escrita. Si el motivo es interno, hay que separarlo en uno para el cliente y otro solo para el equipo. (Vuelta 7)
- **¿El técnico ve el nombre del proveedor de una orden?** La regla dice que del proveedor ve solo dónde retirar, pero
  la lista de órdenes de compra le muestra el nombre a todos (y el chofer lo necesita para saber adónde ir). Hay que
  decidir: nombre para todos, o solo para quien gestiona y para el chofer de esa orden. (Vuelta 9)

## Vueltas

### Vuelta 1 — Acceso: sesiones, claves, invitaciones y guardias

- 12 hallazgos de los agentes; ninguno desmentido. Los revisé en el código: 10 quedaron arreglados (dos venían
  repetidos) y 2 son para la mañana.
- **Arreglado:**
  - El límite de 5 intentos para entrar se saltaba mandando muchos pedidos a la vez; ahora los intentos con un mismo
    correo van de a uno.
  - Cambiar la clave probando la de ahora no tenía límite; ahora cuenta como intento de entrar y queda en la auditoría.
  - Una invitación podía usarse dos veces si llegaban dos pedidos juntos.
  - Se aceptaban claves como «        » u «aaaaaaaa».
  - Entrar por /c/Nuble (con mayúscula) rechazaba a la propia organización y anotaba un intento de acceso falso.
  - El panel del cliente veía los intentos sin permiso del equipo de la plataforma y el texto crudo de los errores del
    servidor; ahora solo los ve la consola.
  - Los mensajes de los formularios que no tenían uno propio salían en inglés («Too big…»); ahora en castellano, en el
    servidor y en las pantallas.
- **Comprobado:** 7 pruebas nuevas en `src/modulos/acceso/noche.test.ts` (10 intentos a la vez dejan solo 5, dos
  aceptaciones a la vez dejan entrar a una, etc.). 163 pruebas y los tipos pasan.
- **Para el dueño:** recuperar la clave olvidada y la IP de la auditoría (arriba).

### Vuelta 2 — Taller: reparto, situación y bloqueos

- 13 hallazgos; los agentes desmintieron 2 y estuve de acuerdo con ellos (el chofer sí debe ver el teléfono del
  proveedor para retirar, y adelantar un trabajo que espera repuestos es a propósito: se empieza, pero no se termina
  sin ellos). De los 11 restantes, 3 venían repetidos; arreglé los 8.
- **Arreglado:**
  - Si se adelantaba y terminaba el armado con el diagnóstico pendiente, la OT pasaba a control de calidad. Ahora pasa
    cuando todo está hecho.
  - Una actividad de una sección apagada se podía volver a encender y agregar a una OT, y el trabajo desaparecía del
    tablero. Ya no.
  - Una actividad de una pieza propia que ya no se usa entraba igual a una OT.
  - Una sección sin especialistas contaba cero días de cola: la entrega sugerida salía días más temprano. Ahora cuenta
    como si la hiciera una persona.
  - Dos que tocan «Iniciar» a la vez se quitaban el trabajo uno al otro; lo mismo con «Terminar».
  - Dos que crean la misma pieza propia a la vez dejaban dos con el mismo nombre.
  - Mensajes que decían algo falso: adelantar con la máquina detenida respondía «ya se puede empezar», y aprobar
    calidad o entregar una OT ya entregada decía «primero se terminan los trabajos».
- **Comprobado:** 6 pruebas nuevas en `src/modulos/taller/noche.test.ts`; las 6 fallan con el código de antes y pasan
  con el arreglo. 169 pruebas y los tipos pasan.
- **Para el dueño:** nada nuevo.

### Vuelta 3 — Cotizaciones y clientes

- 16 hallazgos; los agentes desmintieron 3 y estuve de acuerdo (la cantidad de una línea se puede escribir a mano a
  propósito, el aviso de OT cerrada al aceptar es correcto, y un proveedor desactivado no rompe nada). De los 13
  restantes, 3 venían repetidos: arreglé 9 y dejé 1 para la mañana.
- **Arreglado:**
  - Aceptar y rechazar (o anular) la misma cotización a la vez: la segunda pisaba a la primera y podía dejar una OT
    viva con su cotización «rechazada». Ahora gana una y la otra avisa «ya se decidió».
  - Guardar un borrador mientras otro lo enviaba cambiaba lo que el cliente ya recibió. Ya no.
  - Se podía enviar una cotización cuya OT ya se había cerrado, y después no había cómo aceptarla. Ahora avisa antes.
  - Anular una cotización no dejaba rastro en el registro; ahora queda con su motivo.
  - Una línea sin descripción: el error no decía cuál era y el botón Enviar no avisaba. Ahora dice «línea 2».
  - Al elegir la OT en una cotización nueva no se copiaban sus cilindros, válvulas ni culatas, y el rectificado
    salía contado para 4. Ahora se copian y las líneas se cuentan de nuevo.
  - Un borrador ligado a una OT cerrada mostraba su id interno en vez del folio.
  - La lista mostraba la fecha de creación de los borradores en la columna «Enviada».
  - Un estado de cotización mal escrito en la dirección devolvía todas.
- **Comprobado:** 7 pruebas nuevas en `src/modulos/comercial/noche.test.ts`; las 7 fallan con el código de antes. 176
  pruebas y los tipos pasan. Las dos pantallas cambiadas no las miré en el navegador (ver «Para la mañana»).
- **Para el dueño:** el proveedor escrito a mano (arriba).

### Vuelta 4 — Compras, proveedores y bodega

- 17 hallazgos; ninguno desmentido. Varios venían repetidos: eran 12 distintos. Arreglé 11; el que dejé es que la
  comparación de costos solo mira repuestos y no insumos, y eso es lo que dice la pantalla («Repuestos que llegaron»).
- **Arreglado:**
  - Dos órdenes de compra emitidas a la vez con el mismo repuesto lo dejaban en las dos, y una quedaba «por retirar»
    vacía.
  - Recibir y anular la misma orden a la vez podía dejarla anulada con la mercadería ya en bodega.
  - Un chofer que después pasó a solo lectura seguía pudiendo recibir y sumar stock.
  - Recibir con el id de una línea de insumo de otro cliente no dejaba anotado el intento.
  - Anular una orden de compra no quedaba en el registro; ahora queda con su motivo.
  - Un insumo que se usa poco aparecía sin movimientos si la bodega tenía más de 500 en total; ahora cada insumo
    muestra sus 5 últimos.
  - Lo pagado sin costo cotizado quedaba «por anotar» para siempre en la comparación de costos.
  - El campo «Factura» podía borrar la que anotó otra persona (lo mismo que ya se arregló en «Costo real»).
  - Dejar vacío el mínimo de un insumo daba un error; ahora es cero.
  - Mensajes: el insumo fuera de uso ahora se nombra, y el de recibir dos veces ya no pide «volver a abrir la orden»
    (no hay ese botón).
- **Comprobado:** 9 pruebas nuevas en `src/modulos/compras/noche.test.ts`; las 9 fallan con el código de antes. 185
  pruebas y los tipos pasan. El cambio de pantalla (campo Factura) no lo miré en el navegador, por el servidor de la
  otra sesión.
- **Para el dueño:** nada nuevo.

### Vuelta 5 — Máquinas

- 12 hallazgos; uno desmentido, que en realidad es una pregunta para el dueño (arriba). De los otros 11, 2 venían
  repetidos: arreglé 8 y dejé uno de lado (ver abajo).
- **Arreglado:**
  - «Trabajos por hacer» contaba también los que ya estaban en proceso, que siguen aunque la máquina pare.
  - Con dos máquinas detenidas que comparten una actividad, «N trabajos esperan» los contaba dos veces.
  - Sacar de uso una máquina detenida dejaba su parada abierta: al volver a usarla reaparecía «en falla» desde hace
    días y sus trabajos volvían a esperar.
  - La última mantención aceptaba una fecha futura (un año mal escrito), y la máquina nunca vencía.
  - Dos que detienen la misma máquina a la vez: el segundo recibía un error del servidor en vez de «ya está
    detenida».
  - Al editar una máquina con una actividad apagada, se veía su id interno en vez del nombre.
  - «Volver a operar» después de una mantención no avisaba que la mantención quedó hecha.
  - Faltaba la prueba de aislamiento de «Mantención hecha» (la ruta ya estaba protegida).
- **Lo que dejé:** iniciar un trabajo justo en el mismo instante en que alguien detiene su máquina puede dejarlo
  iniciado (milisegundos). Arreglarlo pide repetir la revisión dentro de la transacción; es poco probable y no lo
  toqué esta noche.
- **Comprobado:** 5 pruebas nuevas en `src/modulos/maquinas/noche.test.ts`; 4 fallan con el código de antes (la
  quinta es la de aislamiento, que pasa con los dos). 190 pruebas y los tipos pasan. La pantalla de máquinas no la
  miré en el navegador, por el servidor de la otra sesión.
- **Para el dueño:** las dos máquinas para una actividad y el uso de máquinas y bodega (arriba).

### Vuelta 6 — Consola de la plataforma

- 14 hallazgos. El desmentido tenía razón en que el límite de almacenamiento no se aplica, pero igual le puse «(MB)»
  a su casilla, porque se veía en GB. Uno era la IP del balanceador, ya anotada para la mañana. Arreglé los otros 12.
- **Arreglado:**
  - Un cliente en prueba que pasaba por suspendido antes de activarse quedaba activo cobrando $0.
  - Cancelar no dejaba de cobrar: un cliente cancelado con el pago fallido seguía contando en «pagos fallidos» y
    dando alertas. Ahora queda «Cancelado» y, si vuelve, vuelve a cobrarse lo que pagaba.
  - Cambiar de plan no movía el cobro: de Free a Starter quedaba «Sin cobro» con $39.000 al mes, y al revés seguía
    con fecha de cobro.
  - El próximo cobro del 31 de enero caía el 3 de marzo; ahora el 28 de febrero.
  - El resumen, la actividad y la seguridad de un cliente mostraban IPs completas sin pedirlas con permiso.
  - Un límite puesto en cero con algo usado se mostraba al 0 %, sin alerta.
  - El almacenamiento de un cliente que dejó de entrar hace más de un mes salía en 0 MB.
  - El filtro «Creado hasta» usaba el día UTC: un cliente creado a las 22:30 del 14 no salía en el 14.
  - Encender una función y bloquear a alguien desde la consola ahora quedan con antes y después en la auditoría.
  - «6.0 veces lo normal» ahora dice «6,0»; «Entrar como» avisa cuando el cliente no tiene un administrador activo.
- **Comprobado:** 8 pruebas nuevas en `src/modulos/plataforma/noche.test.ts`; las 8 fallan con el código de antes.
  198 pruebas y los tipos pasan. Las dos pantallas cambiadas (límites y «Entrar como») no las miré en el navegador.
- **Para el dueño:** nada nuevo.

### Vuelta 7 — Panel de la organización y alta de personas

- 11 hallazgos; ninguno desmentido. Uno era la IP del balanceador (ya anotada) y otro, el motivo del equipo, lo dejé
  para la mañana. Arreglé los otros 9.
- **Arreglado:**
  - La auditoría del cliente mostraba la IP y el navegador de quien del equipo hizo algo. Ahora dice quién y qué, sin
    eso; la consola lo sigue viendo.
  - El administrador del cliente podía desbloquear a alguien que bloqueó el equipo de la plataforma (por abuso o una
    cuenta robada). Ya no: le dice que escriba al equipo.
  - La consola podía bloquear o quitarle el rol al único administrador activo de un cliente, y después nadie podía
    entrar como él. Ahora la consola respeta la misma regla que el panel.
  - Anular una invitación justo cuando la persona la aceptaba podía borrar a alguien que ya había entrado.
  - Un enlace nuevo dejaba «Enviada» con la fecha del primero.
  - Agregar a alguien con el correo de una persona ya invitada o bloqueada no decía qué hacer; ahora lo dice.
  - Con la organización suspendida se podían abrir las acciones de cada persona y llenarlas para recibir un rechazo al
    final; ahora no aparecen.
  - «Agregar persona» deshabilitado no explicaba por qué al pasar el mouse.
  - «Administradores» contaba distinto en el resumen y en Usuarios (uno contaba a los bloqueados).
- **Comprobado:** 6 pruebas nuevas en `src/modulos/organizacion/noche.test.ts`; 5 fallan con el código de antes (la
  sexta revisa una carrera que no siempre se da). 204 pruebas y los tipos pasan. Las pantallas no las miré en el
  navegador.
- **Para el dueño:** el motivo del equipo en la auditoría del cliente (arriba).

### Vuelta 8 — Pantallas del taller

- 13 hallazgos. El desmentido tenía razón en que el servidor no pierde el dato, pero igual en pantalla se veía un
  código crudo, así que también lo arreglé. Varios venían repetidos: arreglé los 9 distintos.
- **Arreglado:**
  - «Entregadas este mes» del inicio abría todas las entregadas de la historia. Ahora abre las del mes (con una
    etiqueta para quitar ese filtro).
  - La OT con un motor sin cilindros decía «se cotiza como 2 válvulas por cilindro y 1 culata» aunque se contaban 3 y
    2. Ahora dice lo que se cuenta y marca lo que es supuesto.
  - La ficha de un trabajo detenido sin nota decía «Detenido: » y nada más; ahora dice el motivo.
  - Renombrar secciones o piezas: un nombre borrado dejaba la casilla en blanco, y lo escrito podía pisar después un
    cambio de otra persona.
  - Quitar una actividad de una cotización dejaba a sus repuestos mostrando un código crudo en «Lo espera».
  - Si la OT desde la que se cotiza no cargaba, se abría un borrador vacío sin aviso.
  - Plurales: «1 abiertas», «1 cotizaciones», «1 clientes».
- **Comprobado:** 2 pruebas nuevas en `src/modulos/taller/pantallas.test.ts` (el texto del motor y la lista del mes).
  Miré en el navegador la tarjeta «Entregadas este mes»: abre 36, la misma cifra del inicio, sin errores en la
  consola. 206 pruebas y los tipos pasan.
- **Para el dueño:** nada nuevo.

### Vuelta 9 — Pantallas de compras, organización y consola (cerrada a medias por el cupo)

- 20 hallazgos (3 desmentidos). Para cuidar el cupo arreglé solo lo importante; el resto queda anotado abajo.
- **Arreglado:**
  - **Entrar con un correo que está en dos rectificadoras no funcionaba:** al elegir a cuál entrar, la pantalla
    mandaba el pedido sin correo ni clave, y no se podía entrar. Ahora usa los del intento.
  - Un chofer que pasó a solo lectura veía botones de «Recibido» que siempre fallaban.
  - El filtro de fechas de la auditoría cortaba el día en UTC: «hasta el 14» dejaba fuera lo de las 22:00 del 14.
- **Quedó sin hacer (de bajo riesgo):** el contador «Pedir N elegidos» puede contar repuestos que otro ya pidió; el
  chofer de una orden puede verse como su id si ya no está; el buscador de clientes de la consola no se limpia al
  quitar los filtros; vaciar la cantidad de un insumo en la orden la vuelve a llenar; la cifra «Insumos» de bodega
  cuenta también los repuestos guardados; al agregar a alguien desde la consola el rol parte en administrador; y
  algunas concordancias de plurales.
- **Comprobado:** 1 prueba nueva (`src/modulos/eventos/noche.test.ts`). 207 pruebas y los tipos pasan. El arreglo de
  entrar no lo probé en el navegador (la demostración no tiene un correo en dos rectificadoras).
- **Para el dueño:** el nombre del proveedor para el técnico (arriba). El motivo interno del equipo en la auditoría
  del cliente volvió a salir en esta vuelta; ya estaba anotado.
