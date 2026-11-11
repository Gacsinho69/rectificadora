# Rectificadora — guía para agentes

Consola del equipo de la plataforma y panel del administrador de cada cliente, para el SaaS multitenant de rectificadoras. Qué es, cómo se corre y qué falta: [README.md](README.md).

## El dueño

No es programador. Todo en castellano de Chile, simple, con un caso del taller cuando ayude. Pregunta solo si la duda cambia el negocio; lo técnico lo decides tú.

## Reglas que no se rompen

- **Aislamiento entre clientes.** En `/api/organizacion` el tenant sale solo de `c.var.actor.tenantId`; nunca de un parámetro, encabezado o cuerpo. Un id que llega en el pedido se busca con `usuarioDelTenant` (o su equivalente para otra tabla), que anota el intento cruzado. Toda ruta nueva del panel lleva su prueba de aislamiento en `acceso/aislamiento.test.ts`.
- **Acciones sensibles**: `exigirPermiso` antes de tocar nada, motivo obligatorio, y el cambio y su evento (`registrar`) en la misma transacción, con antes y después en `metadata`.
- **El panel del cliente no recibe nada interno** (salud, alertas, datos de otros clientes). La prueba «el resumen del cliente no trae salud ni alertas» lo vigila.
- **`events` solo se agrega.** Nada de `update` ni `delete` sobre esa tabla.
- **Datos de clientes y tipos de evento en inglés** (como la especificación: `tenant_id`, `user.login`); código, comentarios y pantallas en castellano.

## Cómo se trabaja

- Stack igual que ERP Nuevo: Hono dentro de Vite, React + Ant Design (solo esa biblioteca de controles), TanStack Router (todas las direcciones en `src/pantallas/rutas.tsx`) y Query (nada de `fetch` en `useEffect`), Drizzle + PGlite, Zod, Vitest.
- Cada módulo en `src/modulos/<modulo>/`: `tablas.ts`, `reglas.ts` (puras, sin servidor: las pantallas las importan), `rutas.ts`, `pantallas/`.
- Pantallas sobrias y densas: un solo azul, letra de 13 px, bloques blancos con borde fino; el color solo en los estados y siempre con su palabra. Mirar todo cambio a 1440 y a 390 de ancho.
- Cambiar una tabla: editar su `tablas.ts` y `npm run migracion`. Cambiar la siembra: `npm run demo:reiniciar`.
- `npm test` y `npm run tipos` antes de entregar. Entrega: qué cambió, qué comprobaste y qué falta.
