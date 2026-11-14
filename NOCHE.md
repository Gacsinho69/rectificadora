# Mejoras de la noche

Rama local `mejoras-nocturnas` (sale de `main` en `a4dd7a3`). Nada subido a GitHub. Cada vuelta: agentes Haiku buscan,
otro agente Haiku intenta desmentir, reviso en el código, arreglo lo confirmado con su prueba, `npm test` y
`npm run tipos`, y commit local.

## Áreas

- [x] Acceso: sesiones, claves, invitaciones y guardias (vuelta 1)
- [x] Taller: reparto, situación y bloqueos (vuelta 2)
- [ ] Cotizaciones y clientes
- [ ] Compras, proveedores y bodega
- [ ] Máquinas
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
