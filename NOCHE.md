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
- [ ] Consola de la plataforma: acciones, panorama, alertas y salud
- [ ] Panel de la organización y alta de personas
- [ ] Pantallas del taller
- [ ] Pantallas de compras, organización y consola
- [ ] Producción: servidor, encabezados y contenedor

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
- **Otra sesión usa esta carpeta.** A las 04:40 había un servidor de prueba de otra sesión corriendo aquí (puerto 5182,
  con `.claude/revision.env`). No lo toqué. Por eso en la vuelta 3 no abrí el sistema en el navegador. (Vuelta 3)
- **Dos máquinas para la misma actividad.** Si el taller tiene dos lineadoras y una se detiene, hoy todos los trabajos
  de lineado quedan «esperando su máquina», aunque la otra esté operando. ¿Debería bloquear solo cuando estén
  detenidas todas las máquinas de esa actividad? (Vuelta 5)
- **El uso de máquinas y bodega en la consola.** La regla dice que lo que hace una rectificadora suma a su uso, pero
  detener máquinas, anotar mantenciones o mover la bodega no suma nada: la consola no ve si un cliente usa esos
  módulos. Hay que decidir qué se cuenta (y si «Máquinas» va como uso aparte). (Vuelta 5)

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
