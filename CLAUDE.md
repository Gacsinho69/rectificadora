# Rectificadora — guía para agentes

SaaS multicliente para rectificadoras: el sistema de cada rectificadora (recepción, OT, cotizaciones, taller por sección), la administración de cada organización y la consola de la plataforma. Qué es, cómo se corre y qué falta: [README.md](README.md).

## El dueño

No es programador. Todo en castellano de Chile, simple, con un caso del taller cuando ayude. Pregunta solo si la duda cambia el negocio; lo técnico lo decides tú. La referencia del negocio es el ERP de Baufer (`DEV\ERP Nuevo\LOGICA.md`): se puede leer, no se edita desde aquí.

## Reglas que no se rompen

- **Aislamiento entre clientes.** En `/api/servicio` y `/api/organizacion` el tenant sale solo de `c.var.actor.tenantId`; nunca de un parámetro, encabezado o cuerpo. Todo id que llega en el pedido se busca con `filaDelTenant`, que anota el intento cruzado. Toda ruta nueva lleva su prueba de aislamiento.
- **El estado de una OT se calcula** (`estadoDeOt`) y se guarda con `recalcularOt` después de cada cambio de tareas o cotización. No se escribe a mano.
- **La situación de cada trabajo se calcula y no se guarda** (`situacionDe`, en `taller/reglas.ts`): sale de su pieza y su paso, de lo detenido (`task_holds`) y de lo adelantado. Lo que espera su turno o está detenido no se inicia ni se termina.
- **Las cantidades salen del criterio de la actividad** (`cantidadSegun`) con los datos del motor de la OT o la cotización, y los trabajos nuevos se reparten con `repartirOt` (`taller/reparto.ts`), en la misma transacción que los crea.
- **Lo que hace una rectificadora suma a su uso** con `sumarUso`, en la misma transacción. Así la consola mide el uso real.
- **Acciones sensibles de la consola:** `exigirPermiso`, motivo obligatorio, y el cambio y su evento (`registrar`) en la misma transacción, con antes y después.
- **El técnico no ve montos** (`veMontos`). El sistema y el panel del cliente no reciben nada interno de la plataforma (salud, alertas).
- **`events` solo se agrega.** Nada de `update` ni `delete` sobre esa tabla.
- **Datos en inglés** (`tenant_id`, `work_order.created`), como la especificación; código, comentarios y pantallas, en castellano.

## Cómo se trabaja

- Stack igual que ERP Nuevo: Hono dentro de Vite, React + Ant Design (solo esa biblioteca de controles), TanStack Router (todas las direcciones en `src/pantallas/rutas.tsx`) y Query (nada de `fetch` en `useEffect`), Drizzle + PGlite, Zod, Vitest.
- Cada módulo en `src/modulos/<modulo>/`: `tablas.ts`, `reglas.ts` (puras, sin servidor: las pantallas las importan), `rutas.ts`, `pantallas/`.
- Pantallas sobrias y densas: un solo azul, letra de 13 px, bloques blancos con borde fino; el color solo en los estados y siempre con su palabra. Todo cambio se mira a 1440 y a 390 de ancho.
- Cambiar una tabla: editar su `tablas.ts` y `npm run migracion`. Cambiar la siembra: `npm run demo:reiniciar`.
- `npm test` y `npm run tipos` antes de entregar. Entrega: qué cambió, qué comprobaste y qué falta.
