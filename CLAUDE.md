# Rectificadora — guía para agentes

SaaS multicliente para rectificadoras: el sistema de cada rectificadora (recepción, OT, cotizaciones, taller por sección), la administración de cada organización y la consola de la plataforma. Qué es, cómo se corre y qué falta: [README.md](README.md).

## El dueño

No es programador. Todo en castellano de Chile, simple, con un caso del taller cuando ayude. Pregunta solo si la duda cambia el negocio; lo técnico lo decides tú. La referencia del negocio es el ERP de Baufer (`DEV\ERP Nuevo\LOGICA.md`): se puede leer, no se edita desde aquí.

## Reglas que no se rompen

- **Aislamiento entre clientes.** En `/api/servicio` y `/api/organizacion` el tenant sale solo de `c.var.actor.tenantId`; nunca de un parámetro, encabezado o cuerpo. Todo id que llega en el pedido se busca con `filaDelTenant`, que anota el intento cruzado; una pieza, con `exigirPiezas`. Toda ruta nueva lleva su prueba de aislamiento.
- **El estado de una OT se calcula** (`estadoDeOt`) y se guarda con `recalcularOt` después de cada cambio de tareas o cotización. No se escribe a mano.
- **La situación de cada trabajo se calcula y no se guarda** (`situacionDe`, en `taller/reglas.ts`): sale de su pieza y su paso, de lo detenido (`task_holds`), de los repuestos que le faltan (`work_order_parts`), de las máquinas detenidas que necesita (`machine_stops`; los dos con `bloqueosDe`) y de lo adelantado. Lo que espera su máquina, repuestos o su turno, o está detenido, no se inicia; sin sus repuestos tampoco se termina.
- **El estado de una orden de compra sale de sus repuestos y sus insumos** (`estadoDeOc`) y se guarda con `recalcularOc` cada vez que algo se recibe o se anula. El técnico no ve costos ni proveedores.
- **El stock de un insumo se mueve solo con `moverInsumo`**, que deja su movimiento en la misma transacción: la compra al recibirse, el consumo y el ajuste al conteo.
- **El proveedor sale de la lista** (`suppliers`): una orden de compra va siempre a uno de la lista, activo. Su nombre va guardado junto a cada orden y cada repuesto; al corregirlo en la lista se corrige en todos, en la misma transacción. El mismo nombre no se repite (`claveDeProveedor`). El técnico no ve la lista: del proveedor ve solo dónde retirar una orden.
- **Las cantidades salen del criterio de la actividad** (`cantidadSegun`) con los datos del motor de la OT o la cotización, y los trabajos nuevos se reparten con `repartirOt` (`taller/reparto.ts`), en la misma transacción que los crea.
- **Toda persona nueva entra con `agregarPersona`** (`usuarios/alta.ts`), en la misma transacción que su evento: respeta el límite de usuarios del plan (las invitaciones también ocupan su lugar), no repite el correo en la organización y la deja invitada, con su enlace. Una rectificadora nueva nace con `tallerInicial` y su plantilla.
- **Lo que hace una rectificadora suma a su uso** con `sumarUso`, en la misma transacción. Así la consola mide el uso real.
- **Acciones sensibles de la consola:** `exigirPermiso`, motivo obligatorio, y el cambio y su evento (`registrar`) en la misma transacción, con antes y después.
- **El técnico no ve montos** (`veMontos`). El sistema y el panel del cliente no reciben nada interno de la plataforma (salud, alertas).
- **Claves y sesiones.** La clave se guarda solo derivada (`cifrarClave`); de los secretos de sesión e invitación, solo su huella. Bloquear a alguien o cambiar su clave cierra sus sesiones (`cerrarSesionesDe`). «Entrar como» existe solo en `desarrollo.ts`. Alguien del equipo de la plataforma entra solo con `agregarAlEquipo` (`npm run equipo`), con su evento.
- **`events` solo se agrega.** Nada de `update` ni `delete` sobre esa tabla.
- **Datos en inglés** (`tenant_id`, `work_order.created`), como la especificación; código, comentarios y pantallas, en castellano.

## Cómo se trabaja

- Stack igual que ERP Nuevo: Hono dentro de Vite, React + Ant Design (solo esa biblioteca de controles), TanStack Router (todas las direcciones en `src/pantallas/rutas.tsx`) y Query (nada de `fetch` en `useEffect`), Drizzle + PGlite, Zod, Vitest.
- Cada módulo en `src/modulos/<modulo>/`: `tablas.ts`, `reglas.ts` (puras, sin servidor: las pantallas las importan), `rutas.ts`, `pantallas/`.
- Pantallas sobrias y densas: un solo azul, letra de 13 px, bloques blancos con borde fino; el color solo en los estados y siempre con su palabra. Todo cambio se mira a 1440 y a 390 de ancho.
- En una subconsulta escrita con `sql` dentro de un `select`, la columna de la tabla de afuera va con su tabla (`"customers"."id"`): Drizzle la escribe sin ella y `id` a secas sería el de la tabla de adentro.
- La API se arma en `crearApp` (`servidor.ts`): la montan `desarrollo.ts` y `produccion/app.ts`. Lo de producción (encabezados, pantallas, subdominios) va en `produccion/`; ahí no entra nada de desarrollo. `npm run build` compila las pantallas y el servidor.
- Cambiar una tabla: editar su `tablas.ts` y `npm run migracion`. Cambiar la siembra: `npm run demo:reiniciar`.
- `npm test` y `npm run tipos` antes de entregar. Entrega: qué cambió, qué comprobaste y qué falta.
