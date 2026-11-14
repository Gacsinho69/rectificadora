// El sistema de cada rectificadora: recepción, órdenes de trabajo, el tablero del taller por sección, la carga y las
// actividades con su valor y sus especialistas. Todo filtrado por el tenant de quien pide (`c.var.actor.tenantId`); lo nombrado por
// id pasa por `filaDelTenant`. Cada pedido suma una llamada a la API en el uso del cliente.
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { z } from 'zod'
import type { Base } from '../../base'
import { conDatos, conFiltros, rechazo } from '../../http'
import { nuevoId } from '../../ids'
import { type EntornoTenant, filaDelTenant, filasDelTenant, soloPersonaDelTenant } from '../acceso/guardias'
import { rutasComercial } from '../comercial/rutas'
import { quotes, customers } from '../comercial/tablas'
import { anularRepuestosDeOt } from '../compras/comun'
import { folioOc, POR_LLEGAR } from '../compras/reglas'
import { rutasCompras } from '../compras/rutas'
import { rutasMaquinas } from '../maquinas/rutas'
import { purchaseOrders, purchaseOrderSupplies, suppliers, supplies, workOrderParts } from '../compras/tablas'
import { origenDe, registrar } from '../eventos/registrar'
import { users } from '../usuarios/tablas'
import { exigirCupoDeOt, exigirGestion, gestiona, motorDe, recalcularOt, siguienteNumero, sumarUso, veMontos } from './comun'
import { exigirPiezas, piezasPropias, rutasPiezas } from './piezas'
import {
  avanceDeOt,
  cantidadSegun,
  CRITERIOS,
  diaEnChile,
  diagnosticoDeRecepcion,
  diasParaTerminar,
  ESTADOS_OT,
  type EstadoOt,
  fechaTrasDiasHabiles,
  grupoDe,
  horasReales,
  MOTIVOS_DETENCION,
  nombreDeTarea,
  ordenDeGrupo,
  OT_ABIERTAS,
  piezasDeOt,
  plazoDeOt,
  PRIORIDADES_OT,
  recontarTarea,
  rendimientoDe,
  type Situacion,
  unidadDe,
} from './reglas'
import { bloqueosDe, cargaDelTaller, conSituacion, detencionAbierta, detencionVisible, OT_EN_TALLER, repartirOt, type TrabajoAbierto, trabajosAbiertos, unirDetencion } from './reparto'
import { services, serviceSpecialists, shopSections, taskHolds, workOrders, workOrderTasks } from './tablas'
import { diaSchema } from '../../fecha'

type C = Context<EntornoTenant>
const claves = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]]
/** «a», «a y b», «a, b y c». */
const enumerar = (l: string[]) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} y ${l.at(-1)}`)

/** Cada pedido al sistema cuenta como una llamada a la API del cliente. */
const contarUso: MiddlewareHandler<EntornoTenant> = async (c, next) => {
  await next()
  await sumarUso(c.var.base, c.var.actor.tenantId, c.var.ahora, { apiCalls: 1 }).catch(() => {})
}

/** Cilindros, válvulas por cilindro y culatas: con esto se cuentan las actividades por cilindro, válvula, biela o culata. */
const datosDelMotor = z.object({
  cilindros: z.number().int().min(1).max(24).nullable().optional(),
  valvulasPorCilindro: z.number().int().min(1).max(6).nullable().optional(),
  culatas: z.number().int().min(1).max(24).nullable().optional(),
})

const recepcion = z.object({
  clienteId: z.string().min(1, 'Elige el cliente.'),
  motor: z.string().trim().min(2, 'Escribe el motor (marca y modelo).').max(80),
  numeroMotor: z.string().trim().max(60).optional(),
  equipo: z.string().trim().max(120).optional(),
  // Las de siempre o las propias del taller (su id); la ruta revisa que sean de la rectificadora.
  piezas: z.array(z.string().max(40)).min(1, 'Marca qué piezas llegaron.').max(40),
  falla: z.string().trim().max(1000).optional(),
  entrega: diaSchema.nullable().optional(),
  prioridad: z.enum(claves(PRIORIDADES_OT)).default('normal'),
  ...datosDelMotor.shape,
  /** Agregar el diagnóstico: lo normal cuando hay que medir antes de cotizar. */
  diagnostico: z.boolean().default(true),
})

/** Los nombres de las personas del cliente, para mostrar quién tiene cada tarea. */
async function nombresDe(c: { var: EntornoTenant['Variables'] }) {
  const lista = await c.var.base.select({ id: users.id, nombre: users.name }).from(users).where(eq(users.tenantId, c.var.actor.tenantId))
  return new Map(lista.map((u) => [u.id, u.nombre]))
}

/** Avance, conteo de tareas y trabajos detenidos de varias OT a la vez. */
async function avancesDe(c: { var: EntornoTenant['Variables'] }, ids: string[]) {
  if (!ids.length) return new Map<string, { avance: number; total: number; hechas: number; detenidas: number }>()
  const tareas = await c.var.base
    .select({ ot: workOrderTasks.workOrderId, estado: workOrderTasks.status, minutos: workOrderTasks.stdMinutes, detencion: taskHolds.id })
    .from(workOrderTasks)
    .leftJoin(taskHolds, unirDetencion)
    .where(and(eq(workOrderTasks.tenantId, c.var.actor.tenantId), inArray(workOrderTasks.workOrderId, ids)))
  const porOt = new Map<string, typeof tareas>()
  for (const t of tareas) porOt.set(t.ot, [...(porOt.get(t.ot) ?? []), t])
  return new Map(
    ids.map((id) => {
      const lista = porOt.get(id) ?? []
      return [id, { avance: avanceDeOt(lista), total: lista.length, hechas: lista.filter((t) => t.estado === 'done').length, detenidas: lista.filter((t) => t.detencion).length }]
    }),
  )
}

/** El orden de una cola: lo que está en proceso, lo que se puede hacer (atrasado, urgente, lo que vence antes), lo que espera y lo detenido. */
const RANGO: Record<Situacion, number> = { in_progress: 0, available: 1, machine: 2, parts: 2, waiting: 3, held: 4, done: 5 }
const enCola = (a: TrabajoAbierto, b: TrabajoAbierto, hoy: string) =>
  RANGO[a.situacion] - RANGO[b.situacion] ||
  Number(plazoDeOt(b.ot.entrega, b.ot.estado, hoy) === 'atrasada') - Number(plazoDeOt(a.ot.entrega, a.ot.estado, hoy) === 'atrasada') ||
  Number(b.ot.prioridad === 'urgent') - Number(a.ot.prioridad === 'urgent') ||
  (a.ot.entrega ?? '9999').localeCompare(b.ot.entrega ?? '9999') ||
  a.ot.numero - b.ot.numero ||
  a.t.step - b.t.step

/** La cola de cada sección en días y las horas por día de su gente; sin lo de una OT, para no contarla dos veces. */
async function colasDelTaller(base: Base, tenantId: string, sinOt?: string) {
  const trabajos = (await trabajosAbiertos(base, tenantId)).filter((f) => f.ot.id !== sinOt)
  const { secciones } = await cargaDelTaller(base, tenantId, trabajos)
  // Una sección sin especialistas igual tiene su cola: se cuenta como si la hiciera una persona, no como cero.
  return new Map(secciones.map((s) => [s.id, { dias: s.dias ?? (s.ahora + s.espera) / 8, horasPorDia: Math.max(1, s.gente.length) * 8 }]))
}

/** Lo que define una actividad de la lista. */
const actividad = z.object({
  nombre: z.string().trim().min(3, 'Escribe el nombre de la actividad.').max(120),
  seccionId: z.string().min(1, 'Elige la sección.'),
  pieza: z.string({ error: 'Elige la pieza.' }).min(1, 'Elige la pieza.').max(40),
  criterio: z.enum(claves(CRITERIOS)),
  precio: z.number().int().min(0).max(1_000_000_000).nullable(),
  horas: z.number().min(0).max(1000),
  paso: z.number().int().min(0).max(9999).optional(),
  tipico: z.boolean(),
})
const nombreSeccion = z.string({ error: 'Escribe el nombre de la sección.' }).trim().min(2, 'Escribe el nombre de la sección.').max(60)

/** Dos secciones no se llaman igual (sin contar mayúsculas). */
async function exigirSeccionLibre(c: C, nombre: string, salvo?: string) {
  const [otra] = await c.var.base
    .select({ nombre: shopSections.name })
    .from(shopSections)
    .where(and(eq(shopSections.tenantId, c.var.actor.tenantId), sql`lower(${shopSections.name}) = lower(${nombre})`, salvo ? ne(shopSections.id, salvo) : undefined))
  if (otra) throw rechazo(409, `Ya hay una sección «${otra.nombre}».`)
}

/** Al crear, lo que no se dice va por omisión; al ajustar, solo cambia lo que llega. */
const actividadNueva = actividad.extend({ tipico: z.boolean().default(false) })

function exigirAdministrador(c: C) {
  if (c.var.actor.estadoTenant === 'suspended' || c.var.actor.estadoTenant === 'cancelled') throw rechazo(403, 'Tu organización está suspendida: puedes revisar, pero no hacer cambios.')
  if (c.var.actor.rol !== 'admin') throw rechazo(403, 'Las actividades, sus valores y las secciones los cambia el administrador.')
}

/** Trabaja quien no es de solo lectura, con la organización operando, y sobre lo suyo (el jefe de taller, sobre todo). */
function exigirTrabajo(c: C, t: typeof workOrderTasks.$inferSelect) {
  const { actor } = c.var
  if (actor.rol === 'viewer') throw rechazo(403, 'Tu rol es de solo lectura.')
  if (actor.estadoTenant === 'suspended') throw rechazo(403, 'Tu organización está suspendida.')
  if (t.assignedTo && t.assignedTo !== actor.id && !gestiona(actor.rol)) throw rechazo(403, 'Ese trabajo lo tiene otra persona.')
}

/** El trabajo con su situación en la ruta de su OT: si se puede empezar, qué espera o por qué está detenido. */
async function enSuRuta(c: C, t: typeof workOrderTasks.$inferSelect) {
  const [ot] = await c.var.base.select({ estado: workOrders.status }).from(workOrders).where(eq(workOrders.id, t.workOrderId))
  if (!OT_EN_TALLER.includes(ot.estado)) throw rechazo(409, 'La OT ya no está en el taller.')
  const filas = await c.var.base
    .select({ t: workOrderTasks, detencion: detencionAbierta })
    .from(workOrderTasks)
    .leftJoin(taskHolds, unirDetencion)
    .where(and(eq(workOrderTasks.workOrderId, t.workOrderId), eq(workOrderTasks.tenantId, c.var.actor.tenantId), ne(workOrderTasks.status, 'done')))
  return conSituacion(filas, await bloqueosDe(c.var.base, c.var.actor.tenantId, [t.workOrderId])).find((f) => f.t.id === t.id)!
}

/** Lo detenido, lo que espera repuestos y lo que espera su turno no se inicia ni se termina; el mensaje dice qué falta. */
function exigirQueSePuedaHacer(f: Awaited<ReturnType<typeof enSuRuta>>) {
  if (f.situacion === 'held') throw rechazo(409, `Ese trabajo está detenido (${MOTIVOS_DETENCION[f.detencion!.motivo!].toLowerCase()}). Reanúdalo primero.`)
  if (f.situacion === 'machine') throw rechazo(409, `La máquina está detenida: ${enumerar(f.maquinas)}. Se puede empezar cuando vuelva a operar.`)
  if (f.situacion === 'parts') throw rechazo(409, `Ese trabajo espera repuestos: ${enumerar(f.faltan)}. Cuando lleguen se puede empezar; el jefe de taller puede adelantarlo.`)
  if (f.situacion === 'waiting') throw rechazo(409, `Ese trabajo espera su turno: primero ${enumerar(f.espera)}. El jefe de taller puede adelantarlo.`)
}

/** Lo de una sección apagada no sale en el tablero ni en la carga: ahí no se ponen actividades. */
const SECCION_APAGADA = 'Esa sección está apagada: enciéndela primero o elige otra.'

export const rutasTaller = new Hono<EntornoTenant>()
  .use(soloPersonaDelTenant as unknown as MiddlewareHandler<EntornoTenant>)
  .use(contarUso)

  .get('/inicio', async (c) => {
    const { base, actor, ahora } = c.var
    const hoy = diaEnChile(ahora)
    const ots = await base
      .select({ id: workOrders.id, numero: workOrders.number, estado: workOrders.status, entrega: workOrders.dueDate, prioridad: workOrders.priority, motor: workOrders.engine, cliente: customers.name, creada: workOrders.createdAt, entregada: workOrders.deliveredAt })
      .from(workOrders)
      .innerJoin(customers, eq(customers.id, workOrders.customerId))
      .where(and(eq(workOrders.tenantId, actor.tenantId), or(inArray(workOrders.status, OT_ABIERTAS), sql`${workOrders.deliveredAt} >= date_trunc('month', ${ahora.toISOString()}::timestamptz)`)))
    const abiertas = ots.filter((o) => OT_ABIERTAS.includes(o.estado))
    const conPlazo = abiertas.map((o) => ({ ...o, plazo: plazoDeOt(o.entrega, o.estado, hoy) }))
    const cuantas = (...estados: EstadoOt[]) => abiertas.filter((o) => estados.includes(o.estado)).length
    const urgentes = conPlazo
      .filter((o) => o.plazo || o.prioridad === 'urgent' || o.estado === 'ready')
      .sort((a, b) => (a.entrega ?? '9999').localeCompare(b.entrega ?? '9999'))
      .slice(0, 12)
    const avances = await avancesDe(c, urgentes.map((o) => o.id))
    const trabajos = await trabajosAbiertos(base, actor.tenantId)
    const { secciones } = await cargaDelTaller(base, actor.tenantId, trabajos)
    const misTareas = trabajos.filter((f) => f.t.assignedTo === actor.id).sort((a, b) => enCola(a, b, hoy))
    // Los retiros del chofer: las órdenes de compra por retirar que tiene a su nombre, con lo que hay que traer y dónde.
    const retiros = await base
      .select({ id: purchaseOrders.id, numero: purchaseOrders.number, proveedor: purchaseOrders.supplier, direccion: suppliers.address, telefono: suppliers.phone, llega: purchaseOrders.expectedAt })
      .from(purchaseOrders)
      .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .where(and(eq(purchaseOrders.tenantId, actor.tenantId), eq(purchaseOrders.driverId, actor.id), eq(purchaseOrders.status, 'open')))
      .orderBy(asc(purchaseOrders.number))
    const porTraer = retiros.length
      ? await base
          .select({ oc: workOrderParts.purchaseOrderId, descripcion: workOrderParts.description, medida: workOrderParts.size, cantidad: workOrderParts.quantity, ot: workOrders.number })
          .from(workOrderParts)
          .innerJoin(workOrders, eq(workOrders.id, workOrderParts.workOrderId))
          .where(and(eq(workOrderParts.tenantId, actor.tenantId), inArray(workOrderParts.purchaseOrderId, retiros.map((r) => r.id)), eq(workOrderParts.status, 'ordered')))
      : []
    // Y los insumos de bodega que vienen en esas mismas órdenes.
    const insumosPorTraer = retiros.length
      ? await base
          .select({ oc: purchaseOrderSupplies.purchaseOrderId, descripcion: supplies.name, unidad: supplies.unit, cantidad: purchaseOrderSupplies.quantity })
          .from(purchaseOrderSupplies)
          .innerJoin(supplies, eq(supplies.id, purchaseOrderSupplies.supplyId))
          .where(and(eq(purchaseOrderSupplies.tenantId, actor.tenantId), inArray(purchaseOrderSupplies.purchaseOrderId, retiros.map((r) => r.id)), eq(purchaseOrderSupplies.status, 'ordered')))
      : []
    let comercial = null
    if (veMontos(actor.rol)) {
      const inicioMes = `${hoy.slice(0, 7)}-01`
      const [r] = await base
        .select({
          enviadasMes: sql<number>`count(*) filter (where ${quotes.sentAt} >= ${inicioMes}::date)`.mapWith(Number),
          cotizadoMes: sql<number>`coalesce(sum(${quotes.total}) filter (where ${quotes.sentAt} >= ${inicioMes}::date), 0)`.mapWith(Number),
          aceptadasMes: sql<number>`count(*) filter (where ${quotes.status} = 'accepted' and ${quotes.decidedAt} >= ${inicioMes}::date)`.mapWith(Number),
          aceptadoMes: sql<number>`coalesce(sum(${quotes.total}) filter (where ${quotes.status} = 'accepted' and ${quotes.decidedAt} >= ${inicioMes}::date), 0)`.mapWith(Number),
          pendientes: sql<number>`count(*) filter (where ${quotes.status} = 'sent')`.mapWith(Number),
          montoPendiente: sql<number>`coalesce(sum(${quotes.total}) filter (where ${quotes.status} = 'sent'), 0)`.mapWith(Number),
          decididas90: sql<number>`count(*) filter (where ${quotes.status} in ('accepted', 'rejected') and ${quotes.decidedAt} >= ${hoy}::date - 90)`.mapWith(Number),
          aceptadas90: sql<number>`count(*) filter (where ${quotes.status} = 'accepted' and ${quotes.decidedAt} >= ${hoy}::date - 90)`.mapWith(Number),
        })
        .from(quotes)
        .where(eq(quotes.tenantId, actor.tenantId))
      comercial = { ...r, tasaAceptacion: r.decididas90 ? r.aceptadas90 / r.decididas90 : null }
    }
    return c.json({
      cifras: {
        recibidas: cuantas('received', 'diagnosis'),
        esperando: cuantas('waiting_approval'),
        enTaller: cuantas('in_progress'),
        calidad: cuantas('quality'),
        listas: cuantas('ready'),
        atrasadas: conPlazo.filter((o) => o.plazo === 'atrasada').length,
        porVencer: conPlazo.filter((o) => o.plazo === 'por_vencer').length,
        entregadasMes: ots.filter((o) => o.entregada).length,
        detenidos: trabajos.filter((f) => f.situacion === 'held').length,
        esperanRepuestos: trabajos.filter((f) => f.situacion === 'parts').length,
        esperanMaquina: trabajos.filter((f) => f.situacion === 'machine').length,
      },
      urgentes: urgentes.map((o) => ({ ...o, creada: o.creada.toISOString(), entregada: undefined, ...avances.get(o.id) })),
      carga: secciones.map((s) => ({ seccionId: s.id, nombre: s.nombre, gente: s.gente.length, enProceso: s.enProceso, ahora: s.ahora, espera: s.espera, detenidos: s.nDetenidas, sinAsignar: s.sinAsignar, dias: s.dias })),
      misTareas: misTareas.map((f) => ({ id: f.t.id, nombre: f.t.name, estado: f.t.status, situacion: f.situacion, espera: f.espera, faltan: f.faltan, maquinas: f.maquinas, otId: f.ot.id, ot: f.ot.numero, motor: f.ot.motor, entrega: f.ot.entrega, seccion: f.seccion, pieza: f.t.piece })),
      misRetiros: retiros.map((r) => ({ ...r, repuestos: [
          ...porTraer.filter((x) => x.oc === r.id).map(({ descripcion, medida, cantidad, ot }) => ({ descripcion, medida, cantidad, ot: ot as number | null })),
          ...insumosPorTraer.filter((x) => x.oc === r.id).map(({ descripcion, unidad, cantidad }) => ({ descripcion: `${descripcion} (${unidad})`, medida: null, cantidad, ot: null })),
        ] })),
      comercial,
    })
  })

  .get(
    '/ot',
    conFiltros(z.object({ estado: z.string().optional(), q: z.string().trim().max(80).optional(), pagina: z.coerce.number().int().min(1).default(1), porPagina: z.coerce.number().int().min(10).max(200).default(50) })),
    async (c) => {
      const { base, actor, ahora } = c.var
      const f = c.req.valid('query')
      const estados = !f.estado || f.estado === 'abiertas' ? OT_ABIERTAS : f.estado === 'todas' ? null : (f.estado.split(',').filter((e) => e in ESTADOS_OT) as EstadoOt[])
      const q = f.q ? `%${f.q.replace(/[%_\\]/g, '\\$&')}%` : null
      const numero = f.q && /^\d+$/.test(f.q.replace(/^OT-?/i, '')) ? Number(f.q.replace(/^OT-?/i, '')) : null
      const donde = and(
        eq(workOrders.tenantId, actor.tenantId),
        estados ? inArray(workOrders.status, estados) : undefined,
        q ? or(ilike(customers.name, q), ilike(workOrders.engine, q), ilike(workOrders.engineSerial, q), ilike(workOrders.equipment, q), numero ? eq(workOrders.number, numero) : undefined) : undefined,
      )
      const [{ total }] = await base.select({ total: count() }).from(workOrders).innerJoin(customers, eq(customers.id, workOrders.customerId)).where(donde)
      const filas = await base
        .select({ id: workOrders.id, numero: workOrders.number, cliente: customers.name, motor: workOrders.engine, equipo: workOrders.equipment, piezas: workOrders.pieces, estado: workOrders.status, prioridad: workOrders.priority, entrega: workOrders.dueDate, creada: workOrders.createdAt, entregada: workOrders.deliveredAt })
        .from(workOrders)
        .innerJoin(customers, eq(customers.id, workOrders.customerId))
        .where(donde)
        .orderBy(desc(workOrders.number))
        .limit(f.porPagina)
        .offset((f.pagina - 1) * f.porPagina)
      const avances = await avancesDe(c, filas.map((o) => o.id))
      const hoy = diaEnChile(ahora)
      return c.json({
        total,
        filas: filas.map((o) => ({ ...o, creada: o.creada.toISOString(), entregada: o.entregada?.toISOString() ?? null, plazo: plazoDeOt(o.entrega, o.estado, hoy), ...avances.get(o.id) })),
      })
    },
  )

  /**
   * Recepción: llega un motor o sus piezas. Nace la OT con su diagnóstico: desarme, lavado y medición si viene el
   * motor o el block; prueba de fisuras (y la hidrostática, si viene la culata) si son piezas sueltas.
   */
  .post('/ot', conDatos(recepcion), async (c) => {
    exigirGestion(c)
    const { base, actor, ahora } = c.var
    const d = c.req.valid('json')
    await filaDelTenant(c, customers, d.clienteId, 'customer', 'ese cliente')
    d.piezas = [...new Set(d.piezas)]
    await exigirPiezas(c, d.piezas, true)
    const codigos = diagnosticoDeRecepcion(d.piezas)
    const diagnostico = d.diagnostico && codigos.length
      ? await base
          .select({ id: services.id, nombre: services.name, seccion: services.sectionId, horas: services.stdHours, pieza: services.piece, paso: services.step, criterio: services.criterion })
          .from(services)
          .innerJoin(shopSections, eq(shopSections.id, services.sectionId))
          .where(and(eq(services.tenantId, actor.tenantId), eq(shopSections.kind, 'diagnosis'), eq(services.active, true), inArray(services.code, codigos)))
          .orderBy(asc(services.step), asc(services.code))
      : []
    const id = nuevoId('ot')
    const numero = await base.transaction(async (tx) => {
      const numero = await siguienteNumero(tx, workOrders, actor.tenantId)
      // El cupo se cuenta con el folio tomado: dos recepciones a la vez no pasan las dos con la última OT del mes.
      await exigirCupoDeOt(tx, actor.tenantId, ahora)
      await tx.insert(workOrders).values({
        id,
        tenantId: actor.tenantId,
        number: numero,
        customerId: d.clienteId,
        engine: d.motor,
        engineSerial: d.numeroMotor || null,
        equipment: d.equipo || null,
        pieces: d.piezas,
        cylinders: d.cilindros ?? null,
        valvesPerCylinder: d.valvulasPorCilindro ?? null,
        heads: d.culatas ?? null,
        complaint: d.falla || null,
        priority: d.prioridad,
        dueDate: d.entrega ?? null,
        status: 'received',
        createdBy: actor.id,
        createdAt: ahora,
      })
      const motor = motorDe({ cylinders: d.cilindros ?? null, valvesPerCylinder: d.valvulasPorCilindro ?? null, heads: d.culatas ?? null })
      if (diagnostico.length)
        await tx.insert(workOrderTasks).values(
          diagnostico.map((t, i) => {
            const cantidad = cantidadSegun(t.criterio, motor)
            return { id: nuevoId('tar'), tenantId: actor.tenantId, workOrderId: id, sectionId: t.seccion, serviceId: t.id, name: nombreDeTarea(t.nombre, cantidad, t.criterio), quantity: cantidad, stdMinutes: Math.round(t.horas * cantidad * 60), position: i, piece: t.pieza, step: t.paso, status: 'pending' as const }
          }),
        )
      await repartirOt(tx, actor.tenantId, id)
      await registrar(tx, origenDe(c), { tenantId: actor.tenantId, eventType: 'work_order.created', targetId: id, targetType: 'work_order', metadata: { numero, motor: d.motor, piezas: d.piezas } })
      await sumarUso(tx, actor.tenantId, ahora, { workOrders: 1, features: { work_orders: 1 } })
      return numero
    })
    return c.json({ id, numero })
  })

  /**
   * La entrega que se puede comprometer al recibir: las actividades típicas de lo que llegó (con su diagnóstico),
   * contadas para este motor, por la cola de hoy de cada sección. Un motor completo suma dos días por sus repuestos.
   */
  .get(
    '/entrega-sugerida',
    conFiltros(z.object({ piezas: z.string().min(1).max(200), cilindros: z.coerce.number().int().min(1).max(24).optional(), valvulasPorCilindro: z.coerce.number().int().min(1).max(6).optional(), culatas: z.coerce.number().int().min(1).max(24).optional(), diagnostico: z.enum(['0', '1']).default('1') })),
    async (c) => {
      const { base, actor, ahora } = c.var
      const f = c.req.valid('query')
      const piezas = [...new Set(f.piezas.split(',').filter(Boolean))]
      if (!piezas.length) throw rechazo(400, 'Marca qué piezas llegaron.')
      await exigirPiezas(c, piezas, false)
      const motor = motorDe({ cylinders: f.cilindros ?? null, valvesPerCylinder: f.valvulasPorCilindro ?? null, heads: f.culatas ?? null })
      const completo = piezas.includes('motor')
      const deDiagnostico = diagnosticoDeRecepcion(piezas)
      const actividades = await base
        .select({ codigo: services.code, seccionId: services.sectionId, pieza: services.piece, criterio: services.criterion, horas: services.stdHours, tipico: services.typical, tipo: shopSections.kind })
        .from(services)
        .innerJoin(shopSections, eq(shopSections.id, services.sectionId))
        .where(and(eq(services.tenantId, actor.tenantId), eq(services.active, true), eq(shopSections.active, true)))
      const trabajos = actividades
        .filter((a) => (a.tipo === 'diagnosis' ? f.diagnostico === '1' && deDiagnostico.includes(a.codigo) : a.tipico && (completo || piezas.includes(a.pieza))))
        .map((a) => ({ seccionId: a.seccionId, pieza: a.pieza, diagnostico: a.tipo === 'diagnosis', horas: a.horas * cantidadSegun(a.criterio, motor) }))
      const dias = diasParaTerminar(trabajos, await colasDelTaller(base, actor.tenantId), completo ? 2 : 0)
      return c.json({ dias: Math.round(dias * 10) / 10, fecha: fechaTrasDiasHabiles(diaEnChile(ahora), dias) })
    },
  )

  /**
   * Cuándo se termina de verdad una OT, con lo que le falta, la cola de hoy de cada sección (sin contarla a ella) y sus
   * repuestos por llegar (tres días si falta pedirlos, dos si ya están pedidos). Vacío si ya no está en el taller.
   */
  .get('/ot/:id/entrega-sugerida', async (c) => {
    const { base, actor, ahora } = c.var
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (!OT_EN_TALLER.includes(ot.status)) return c.json(null)
    const filas = await base
      .select({ t: workOrderTasks, tipo: shopSections.kind })
      .from(workOrderTasks)
      .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
      .where(and(eq(workOrderTasks.workOrderId, ot.id), eq(workOrderTasks.tenantId, actor.tenantId), ne(workOrderTasks.status, 'done')))
    if (!filas.length) return c.json(null)
    const porLlegar = await base.select({ estado: workOrderParts.status }).from(workOrderParts).where(and(eq(workOrderParts.workOrderId, ot.id), eq(workOrderParts.tenantId, actor.tenantId), inArray(workOrderParts.status, POR_LLEGAR)))
    const diasRepuestos = porLlegar.some((r) => r.estado === 'pending') ? 3 : porLlegar.length ? 2 : 0
    // Lo que está en proceso ya va por la mitad.
    const trabajos = filas.map(({ t, tipo }) => ({ seccionId: t.sectionId, pieza: t.piece, diagnostico: tipo === 'diagnosis', horas: ((t.status === 'in_progress' ? 0.5 : 1) * t.stdMinutes) / 60 }))
    const dias = diasParaTerminar(trabajos, await colasDelTaller(base, actor.tenantId, ot.id), diasRepuestos)
    return c.json({ dias: Math.round(dias * 10) / 10, fecha: fechaTrasDiasHabiles(diaEnChile(ahora), dias) })
  })

  .get('/ot/:id', async (c) => {
    const { base, actor } = c.var
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    const [cliente] = await base.select().from(customers).where(and(eq(customers.id, ot.customerId), eq(customers.tenantId, actor.tenantId)))
    const filas = await base
      .select({ t: workOrderTasks, seccion: shopSections.name, tipoSeccion: shopSections.kind, detencion: detencionAbierta })
      .from(workOrderTasks)
      .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
      .leftJoin(taskHolds, unirDetencion)
      .where(and(eq(workOrderTasks.workOrderId, ot.id), eq(workOrderTasks.tenantId, actor.tenantId)))
    // Por pieza (diagnóstico, cada pieza, armado y control) y, dentro, en el orden de su ruta.
    const propias = await piezasPropias(base, actor.tenantId)
    const tareas = conSituacion(filas, await bloqueosDe(base, actor.tenantId, [ot.id]))
      .map((f) => ({ ...f, diagnostico: f.tipoSeccion === 'diagnosis', pieza: f.t.piece }))
      .sort((a, b) => ordenDeGrupo(grupoDe(a), propias) - ordenDeGrupo(grupoDe(b), propias) || a.t.step - b.t.step || a.t.position - b.t.position)
    const detenciones = await base.select().from(taskHolds).where(and(eq(taskHolds.workOrderId, ot.id), eq(taskHolds.tenantId, actor.tenantId)))
    const repuestos = await base
      .select({ r: workOrderParts, oc: purchaseOrders.number })
      .from(workOrderParts)
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, workOrderParts.purchaseOrderId))
      .where(and(eq(workOrderParts.workOrderId, ot.id), eq(workOrderParts.tenantId, actor.tenantId)))
      .orderBy(asc(workOrderParts.position))
    const cotizaciones = veMontos(actor.rol)
      ? await base
          .select({ id: quotes.id, numero: quotes.number, estado: quotes.status, total: quotes.total, enviada: quotes.sentAt, decidida: quotes.decidedAt })
          .from(quotes)
          .where(and(eq(quotes.tenantId, actor.tenantId), eq(quotes.workOrderId, ot.id)))
          .orderBy(desc(quotes.number))
      : []
    const nombres = await nombresDe(c)
    const quien = (id: string | null) => (id ? (nombres.get(id) ?? null) : null)
    const iso = (d: Date | null) => d?.toISOString() ?? null
    const nombreDe = new Map(tareas.map((f) => [f.t.id, f.t.name]))
    // La historia de la OT, de lo que quedó guardado: recepción, cotización, cada trabajo y sus detenciones, calidad y entrega.
    const historia = [
      { en: ot.createdAt, que: 'Recepción del motor', quien: quien(ot.createdBy) },
      ...cotizaciones.flatMap((q) => [
        q.enviada ? { en: q.enviada, que: `Cotización COT-${q.numero} enviada`, quien: null } : null,
        q.decidida && (q.estado === 'accepted' || q.estado === 'rejected') ? { en: q.decidida, que: `Cotización COT-${q.numero} ${q.estado === 'accepted' ? 'aceptada' : 'rechazada'}`, quien: null } : null,
      ]),
      ...tareas.flatMap(({ t }) => [
        t.advancedAt ? { en: t.advancedAt, que: `Adelantado: ${t.name}`, quien: quien(t.advancedBy) } : null,
        t.startedAt ? { en: t.startedAt, que: `Inició: ${t.name}`, quien: quien(t.assignedTo) } : null,
        t.finishedAt ? { en: t.finishedAt, que: `Terminó: ${t.name}${t.result ? ` (${t.result})` : ''}`, quien: quien(t.finishedBy) } : null,
      ]),
      ...repuestos.flatMap(({ r }) => [
        // Lo que se pidió con la OT abierta (no venía en la cotización): quién lo pidió y cuándo.
        r.quoteId ? null : { en: r.createdAt, que: `Repuesto pedido: ${r.description}${r.size ? ` (${r.size})` : ''}`, quien: quien(r.createdBy) },
        r.receivedAt ? { en: r.receivedAt, que: r.supplyId ? `Sacado de bodega: ${r.description}` : `Llegó el repuesto: ${r.description}`, quien: quien(r.receivedBy) } : null,
      ]),
      ...detenciones.flatMap((d) => [
        { en: d.createdAt, que: `Detenido: ${nombreDe.get(d.taskId) ?? 'un trabajo'} (${MOTIVOS_DETENCION[d.reason].toLowerCase()}${d.note ? `: ${d.note}` : ''})`, quien: quien(d.createdBy) },
        d.resolvedAt ? { en: d.resolvedAt, que: `Reanudado: ${nombreDe.get(d.taskId) ?? 'un trabajo'}`, quien: quien(d.resolvedBy) } : null,
      ]),
      ot.qcApprovedAt ? { en: ot.qcApprovedAt, que: 'Control de calidad aprobado', quien: quien(ot.qcApprovedBy) } : null,
      ot.deliveredAt ? { en: ot.deliveredAt, que: `Entregada a ${ot.deliveredTo ?? '—'}`, quien: null } : null,
      ot.cancelledAt ? { en: ot.cancelledAt, que: `Anulada: ${ot.cancelReason ?? ''}`, quien: null } : null,
    ]
      .filter((h): h is { en: Date; que: string; quien: string | null } => Boolean(h))
      .sort((a, b) => b.en.getTime() - a.en.getTime())
      .map((h) => ({ ...h, en: h.en.toISOString() }))
    const visibles = tareas.map((f) => ({
      id: f.t.id,
      actividadId: f.t.serviceId,
      nombre: f.t.name,
      cantidad: f.t.quantity,
      seccionId: f.t.sectionId,
      seccion: f.seccion,
      diagnostico: f.diagnostico,
      pieza: f.t.piece,
      grupo: grupoDe(f),
      paso: f.t.step,
      estado: f.t.status,
      situacion: f.situacion,
      espera: f.espera,
      faltan: f.faltan,
      maquinas: f.maquinas,
      detencion: detencionVisible(f.detencion, nombres),
      adelantado: Boolean(f.t.advancedAt),
      horas: f.t.stdMinutes / 60,
      asignadoId: f.t.assignedTo,
      asignado: quien(f.t.assignedTo),
      inicio: iso(f.t.startedAt),
      termino: iso(f.t.finishedAt),
      indicaciones: f.t.instructions,
      resultado: f.t.result,
      horasReales: f.t.status === 'done' && f.t.startedAt && f.t.finishedAt ? horasReales(f.t.startedAt, f.t.finishedAt, detenciones.filter((d) => d.taskId === f.t.id).map((d) => ({ desde: d.createdAt, hasta: d.resolvedAt }))) : null,
    }))
    const porPieza = piezasDeOt(
      visibles.map((t) => ({ ...t, minutos: t.horas * 60, detenido: Boolean(t.detencion) })),
      propias,
    ).map((g) => ({ clave: g.clave, nombre: g.nombre, avance: g.avance, total: g.total, hechas: g.hechas, situacion: g.situacion, actual: g.actual ? { nombre: g.actual.nombre, asignado: g.actual.asignado, espera: g.actual.espera, faltan: g.actual.faltan, detencion: g.actual.detencion } : null }))
    return c.json({
      id: ot.id,
      numero: ot.number,
      estado: ot.status,
      plazo: plazoDeOt(ot.dueDate, ot.status, diaEnChile(c.var.ahora)),
      avance: avanceDeOt(tareas.map(({ t }) => ({ estado: t.status, minutos: t.stdMinutes }))),
      cliente: { id: cliente.id, nombre: cliente.name, contacto: cliente.contact, telefono: cliente.phone },
      motor: ot.engine,
      numeroMotor: ot.engineSerial,
      equipo: ot.equipment,
      piezas: ot.pieces,
      cilindros: ot.cylinders,
      valvulasPorCilindro: ot.valvesPerCylinder,
      culatas: ot.heads,
      falla: ot.complaint,
      prioridad: ot.priority,
      entrega: ot.dueDate,
      creada: ot.createdAt.toISOString(),
      entregada: iso(ot.deliveredAt),
      entregadaA: ot.deliveredTo,
      anulada: iso(ot.cancelledAt),
      motivoAnulacion: ot.cancelReason,
      tareas: visibles,
      porPieza,
      repuestos: repuestos.map(({ r, oc }) => ({
        id: r.id,
        descripcion: r.description,
        cantidad: r.quantity,
        medida: r.size,
        marca: r.brand,
        codigo: r.partNumber,
        compra: r.source,
        proveedor: veMontos(actor.rol) ? r.supplier : null,
        costo: veMontos(actor.rol) ? r.unitCost : null,
        precio: veMontos(actor.rol) ? r.unitPrice : null,
        deBodega: Boolean(r.supplyId),
        costoReal: veMontos(actor.rol) ? r.realCost : null,
        estado: r.status,
        oc: oc ? folioOc(oc) : null,
        ocId: r.purchaseOrderId,
        necesitaId: r.neededByTaskId,
        necesita: r.neededByTaskId ? (nombreDe.get(r.neededByTaskId) ?? null) : null,
        recibido: iso(r.receivedAt),
      })),
      cotizaciones: cotizaciones.map((q) => ({ ...q, enviada: iso(q.enviada), decidida: iso(q.decidida) })),
      historia,
    })
  })

  .post('/ot/:id', conDatos(z.object({ entrega: diaSchema.nullable().optional(), prioridad: z.enum(claves(PRIORIDADES_OT)).optional(), equipo: z.string().trim().max(120).optional(), numeroMotor: z.string().trim().max(60).optional(), falla: z.string().trim().max(1000).optional(), ...datosDelMotor.shape })), async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status === 'delivered' || ot.status === 'cancelled') throw rechazo(409, 'La OT ya está cerrada.')
    const d = c.req.valid('json')
    const { tenantId } = c.var.actor
    const antes = motorDe(ot)
    const despues = motorDe({
      cylinders: d.cilindros !== undefined ? d.cilindros : ot.cylinders,
      valvesPerCylinder: d.valvulasPorCilindro !== undefined ? d.valvulasPorCilindro : ot.valvesPerCylinder,
      heads: d.culatas !== undefined ? d.culatas : ot.heads,
    })
    await c.var.base.transaction(async (tx) => {
      await tx
        .update(workOrders)
        .set({
          ...(d.entrega !== undefined ? { dueDate: d.entrega } : {}),
          ...(d.prioridad ? { priority: d.prioridad } : {}),
          ...(d.equipo !== undefined ? { equipment: d.equipo || null } : {}),
          ...(d.numeroMotor !== undefined ? { engineSerial: d.numeroMotor || null } : {}),
          ...(d.falla !== undefined ? { complaint: d.falla || null } : {}),
          ...(d.cilindros !== undefined ? { cylinders: d.cilindros } : {}),
          ...(d.valvulasPorCilindro !== undefined ? { valvesPerCylinder: d.valvulasPorCilindro } : {}),
          ...(d.culatas !== undefined ? { heads: d.culatas } : {}),
        })
        .where(and(eq(workOrders.id, ot.id), eq(workOrders.tenantId, tenantId)))
      if (JSON.stringify(antes) === JSON.stringify(despues)) return
      // Otro motor (eran 6 cilindros, no 4): lo que falta hacer y se contaba por el motor se cuenta de nuevo.
      const pendientes = await tx
        .select({ t: workOrderTasks, criterio: services.criterion })
        .from(workOrderTasks)
        .innerJoin(services, eq(services.id, workOrderTasks.serviceId))
        .where(and(eq(workOrderTasks.workOrderId, ot.id), eq(workOrderTasks.tenantId, tenantId), eq(workOrderTasks.status, 'pending')))
      for (const { t, criterio } of pendientes) {
        const nuevo = recontarTarea({ nombre: t.name, cantidad: t.quantity, minutos: t.stdMinutes, criterio }, antes, despues)
        if (nuevo) await tx.update(workOrderTasks).set({ quantity: nuevo.cantidad, name: nuevo.nombre, stdMinutes: nuevo.minutos }).where(eq(workOrderTasks.id, t.id))
      }
      await recalcularOt(tx, ot.id)
    })
    return c.json({ ok: true })
  })

  /** Agregar un trabajo de la lista a una OT abierta (una garantía, algo que apareció al armar). Entra en la ruta de su pieza. */
  .post('/ot/:id/tareas', conDatos(z.object({ trabajoId: z.string(), cantidad: z.number().positive().max(1000).optional(), pieza: z.string().max(40).optional() })), async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status === 'delivered' || ot.status === 'cancelled' || ot.status === 'ready') throw rechazo(409, 'A esta OT ya no se le agregan trabajos.')
    const d = c.req.valid('json')
    const trabajo = await filaDelTenant(c, services, d.trabajoId, 'service', 'ese trabajo')
    if (!trabajo.active) throw rechazo(409, 'Esa actividad está fuera de la lista: actívala primero en Actividades.')
    // La pieza en que queda (la que se pidió o la de la actividad) tiene que estar en uso, y su sección encendida.
    await exigirPiezas(c, [d.pieza ?? trabajo.piece], true)
    const [seccion] = await c.var.base.select({ activa: shopSections.active }).from(shopSections).where(and(eq(shopSections.id, trabajo.sectionId), eq(shopSections.tenantId, c.var.actor.tenantId)))
    if (!seccion?.activa) throw rechazo(409, SECCION_APAGADA)
    const cantidad = d.cantidad ?? cantidadSegun(trabajo.criterion, motorDe(ot))
    await c.var.base.transaction(async (tx) => {
      const [{ ultima }] = await tx.select({ ultima: sql<number>`coalesce(max(${workOrderTasks.position}), -1)`.mapWith(Number) }).from(workOrderTasks).where(eq(workOrderTasks.workOrderId, ot.id))
      await tx.insert(workOrderTasks).values({
        id: nuevoId('tar'),
        tenantId: c.var.actor.tenantId,
        workOrderId: ot.id,
        sectionId: trabajo.sectionId,
        serviceId: trabajo.id,
        name: nombreDeTarea(trabajo.name, cantidad, trabajo.criterion),
        quantity: cantidad,
        stdMinutes: Math.round(trabajo.stdHours * cantidad * 60),
        position: ultima + 1,
        piece: d.pieza ?? trabajo.piece,
        step: trabajo.step,
        status: 'pending',
      })
      // Un trabajo nuevo en una OT que estaba en calidad la devuelve al taller.
      if (ot.qcApprovedAt) await tx.update(workOrders).set({ qcApprovedAt: null, qcApprovedBy: null }).where(eq(workOrders.id, ot.id))
      await repartirOt(tx, c.var.actor.tenantId, ot.id)
      await recalcularOt(tx, ot.id)
    })
    return c.json({ ok: true })
  })

  .post('/ot/:id/calidad', async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status === 'ready' || ot.status === 'delivered') throw rechazo(409, ot.status === 'ready' ? 'La calidad de esta OT ya está aprobada.' : 'Esa OT ya se entregó.')
    if (ot.status === 'cancelled') throw rechazo(409, 'Esa OT está anulada.')
    if (ot.status !== 'quality') throw rechazo(409, 'Primero se terminan todos los trabajos del taller.')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrders).set({ qcApprovedAt: c.var.ahora, qcApprovedBy: c.var.actor.id }).where(eq(workOrders.id, ot.id))
      await recalcularOt(tx, ot.id)
    })
    return c.json({ ok: true })
  })

  .post('/ot/:id/entregar', conDatos(z.object({ recibe: z.string().trim().min(2, 'Escribe quién recibe.').max(120) })), async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status === 'delivered') throw rechazo(409, 'Esa OT ya se entregó.')
    if (ot.status !== 'ready') throw rechazo(409, 'Solo se entrega una OT lista (con su control de calidad aprobado).')
    const { recibe } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      // Solo si nadie la entregó entretanto: un doble clic no deja dos entregas ni suma dos veces al uso.
      const [entregada] = await tx.update(workOrders).set({ deliveredAt: c.var.ahora, deliveredTo: recibe }).where(and(eq(workOrders.id, ot.id), eq(workOrders.status, 'ready'), isNull(workOrders.deliveredAt))).returning({ id: workOrders.id })
      if (!entregada) throw rechazo(409, 'Esa OT ya se entregó.')
      await recalcularOt(tx, ot.id)
      await registrar(tx, origenDe(c), { tenantId: c.var.actor.tenantId, eventType: 'work_order.closed', targetId: ot.id, targetType: 'work_order', metadata: { numero: ot.number, recibe } })
      await sumarUso(tx, c.var.actor.tenantId, c.var.ahora, { documents: 1 })
    })
    return c.json({ ok: true })
  })

  .post('/ot/:id/anular', conDatos(z.object({ motivo: z.string().trim().min(5, 'Escribe el motivo.').max(500) })), async (c) => {
    exigirGestion(c)
    const ot = await filaDelTenant(c, workOrders, c.req.param('id'), 'work_order', 'esa orden de trabajo')
    if (ot.status === 'delivered' || ot.status === 'cancelled') throw rechazo(409, 'La OT ya está cerrada.')
    const { motivo } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      await tx.update(workOrders).set({ cancelledAt: c.var.ahora, cancelReason: motivo }).where(eq(workOrders.id, ot.id))
      // Lo detenido de una OT anulada ya no espera nada, y sus repuestos ya no se esperan ni se compran.
      await tx.update(taskHolds).set({ resolvedAt: c.var.ahora, resolvedBy: c.var.actor.id }).where(and(eq(taskHolds.workOrderId, ot.id), isNull(taskHolds.resolvedAt)))
      await anularRepuestosDeOt(tx, c.var.actor.tenantId, ot.id, c.var.ahora)
      await recalcularOt(tx, ot.id)
      await registrar(tx, origenDe(c), { tenantId: c.var.actor.tenantId, eventType: 'work_order.cancelled', targetId: ot.id, targetType: 'work_order', metadata: { numero: ot.number, motivo } })
    })
    return c.json({ ok: true })
  })

  /** Iniciar un trabajo que ya tiene su turno. Quien lo inicia lo toma, si no tenía a nadie. Solo lectura no trabaja. */
  .post('/tareas/:id/iniciar', async (c) => {
    const { actor, ahora } = c.var
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    exigirTrabajo(c, t)
    if (t.status !== 'pending') throw rechazo(409, 'Ese trabajo ya se inició.')
    exigirQueSePuedaHacer(await enSuRuta(c, t))
    await c.var.base.transaction(async (tx) => {
      // Solo si nadie lo inició entretanto: dos que tocan «Iniciar» a la vez no se lo quitan uno al otro.
      const [iniciado] = await tx.update(workOrderTasks).set({ status: 'in_progress', startedAt: ahora, assignedTo: t.assignedTo ?? actor.id }).where(and(eq(workOrderTasks.id, t.id), eq(workOrderTasks.status, 'pending'))).returning({ id: workOrderTasks.id })
      if (!iniciado) throw rechazo(409, 'Ese trabajo ya se inició.')
      await recalcularOt(tx, t.workOrderId)
    })
    return c.json({ ok: true })
  })

  /**
   * Terminar un trabajo, con lo que anotó quien lo hizo (la medida final, lo que encontró). No se termina sin los
   * repuestos que necesita, aunque se haya empezado antes de pedirlos.
   */
  .post('/tareas/:id/terminar', conDatos(z.object({ resultado: z.string().trim().max(1000).optional() })), async (c) => {
    const { actor, ahora } = c.var
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    exigirTrabajo(c, t)
    if (t.status === 'done') throw rechazo(409, 'Ese trabajo ya está terminado.')
    const f = await enSuRuta(c, t)
    exigirQueSePuedaHacer(f)
    if (f.faltan.length) throw rechazo(409, `Falta que llegue: ${enumerar(f.faltan)}. Se termina cuando esté.`)
    const { resultado } = c.req.valid('json')
    await c.var.base.transaction(async (tx) => {
      const [terminado] = await tx.update(workOrderTasks).set({ status: 'done', startedAt: t.startedAt ?? ahora, finishedAt: ahora, finishedBy: actor.id, assignedTo: t.assignedTo ?? actor.id, result: resultado || null }).where(and(eq(workOrderTasks.id, t.id), ne(workOrderTasks.status, 'done'))).returning({ id: workOrderTasks.id })
      if (!terminado) throw rechazo(409, 'Ese trabajo ya está terminado.')
      await recalcularOt(tx, t.workOrderId)
    })
    return c.json({ ok: true })
  })

  /**
   * La ficha de un trabajo: lo que el técnico necesita para hacerlo, sin montos. La OT y el motor, lo que indicó el jefe,
   * lo que ya se hizo en la misma pieza (con lo que anotó cada uno) y los repuestos que espera.
   */
  .get('/tareas/:id', async (c) => {
    const { base, actor } = c.var
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    const [{ o, cliente }] = await base.select({ o: workOrders, cliente: customers.name }).from(workOrders).innerJoin(customers, eq(customers.id, workOrders.customerId)).where(and(eq(workOrders.id, t.workOrderId), eq(workOrders.tenantId, actor.tenantId)))
    const filas = await base
      .select({ t: workOrderTasks, seccion: shopSections.name, detencion: detencionAbierta })
      .from(workOrderTasks)
      .innerJoin(shopSections, eq(shopSections.id, workOrderTasks.sectionId))
      .leftJoin(taskHolds, unirDetencion)
      .where(and(eq(workOrderTasks.workOrderId, t.workOrderId), eq(workOrderTasks.tenantId, actor.tenantId)))
    const todas = conSituacion(filas, await bloqueosDe(base, actor.tenantId, [t.workOrderId]))
    const f = todas.find((x) => x.t.id === t.id)!
    const nombres = await nombresDe(c)
    const quien = (id: string | null) => (id ? (nombres.get(id) ?? null) : null)
    const iso = (d: Date | null) => d?.toISOString() ?? null
    // Lo ya hecho en esta pieza y lo de toda la OT (el desarme, la medición), en el orden de la ruta.
    const anteriores = todas
      .filter((x) => x.t.id !== t.id && x.t.status === 'done' && (t.piece === 'motor' || x.t.piece === 'motor' || x.t.piece === t.piece))
      .sort((a, b) => a.t.step - b.t.step || a.t.position - b.t.position)
      .map((x) => ({ id: x.t.id, nombre: x.t.name, resultado: x.t.result, quien: quien(x.t.finishedBy), termino: iso(x.t.finishedAt) }))
    const repuestos = await base.select().from(workOrderParts).where(and(eq(workOrderParts.neededByTaskId, t.id), eq(workOrderParts.tenantId, actor.tenantId))).orderBy(asc(workOrderParts.position))
    return c.json({
      id: t.id,
      nombre: t.name,
      cantidad: t.quantity,
      pieza: t.piece,
      seccion: f.seccion,
      estado: t.status,
      situacion: f.situacion,
      espera: f.espera,
      faltan: f.faltan,
      maquinas: f.maquinas,
      detencion: detencionVisible(f.detencion, nombres),
      horas: t.stdMinutes / 60,
      asignadoId: t.assignedTo,
      asignado: quien(t.assignedTo),
      inicio: iso(t.startedAt),
      termino: iso(t.finishedAt),
      indicaciones: t.instructions,
      resultado: t.result,
      ot: {
        id: o.id,
        numero: o.number,
        estado: o.status,
        cliente,
        motor: o.engine,
        numeroMotor: o.engineSerial,
        equipo: o.equipment,
        cilindros: o.cylinders,
        valvulasPorCilindro: o.valvesPerCylinder,
        culatas: o.heads,
        falla: o.complaint,
        entrega: o.dueDate,
        prioridad: o.priority,
        plazo: plazoDeOt(o.dueDate, o.status, diaEnChile(c.var.ahora)),
      },
      anteriores,
      repuestos: repuestos.map((r) => ({ id: r.id, descripcion: r.description, cantidad: r.quantity, medida: r.size, marca: r.brand, codigo: r.partNumber, compra: r.source, estado: r.status, recibido: iso(r.receivedAt) })),
    })
  })

  /** Lo que el jefe de taller le indica a quien hace el trabajo («rectificar a 0,50»). Vacío lo borra. */
  .post('/tareas/:id/indicaciones', conDatos(z.object({ texto: z.string().trim().max(1000) })), async (c) => {
    exigirGestion(c)
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    if (t.status === 'done') throw rechazo(409, 'Ese trabajo ya está terminado.')
    await c.var.base.update(workOrderTasks).set({ instructions: c.req.valid('json').texto || null }).where(and(eq(workOrderTasks.id, t.id), eq(workOrderTasks.tenantId, c.var.actor.tenantId)))
    return c.json({ ok: true })
  })

  /**
   * Quien hace un trabajo pide un repuesto que le falta (se quebró una válvula al desarmar la culata): queda por
   * pedir en compras y este trabajo lo espera. Lo puede pedir quien lo tiene, o el jefe de taller.
   */
  .post(
    '/tareas/:id/repuestos',
    conDatos(z.object({ descripcion: z.string().trim().min(2, 'Escribe qué repuesto falta.').max(200), cantidad: z.number().positive('La cantidad debe ser mayor que cero.').max(10_000).default(1), medida: z.string().trim().max(40).optional() })),
    async (c) => {
      const { actor, ahora } = c.var
      const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
      exigirTrabajo(c, t)
      if (t.status === 'done') throw rechazo(409, 'Ese trabajo ya está terminado.')
      await enSuRuta(c, t)
      const d = c.req.valid('json')
      const id = nuevoId('rep')
      const [{ ultimo }] = await c.var.base.select({ ultimo: sql<number>`coalesce(max(${workOrderParts.position}), -1)`.mapWith(Number) }).from(workOrderParts).where(eq(workOrderParts.workOrderId, t.workOrderId))
      await c.var.base.insert(workOrderParts).values({ id, tenantId: actor.tenantId, workOrderId: t.workOrderId, description: d.descripcion, quantity: d.cantidad, size: d.medida || null, position: ultimo + 1, source: 'shop', neededByTaskId: t.id, status: 'pending', createdBy: actor.id, createdAt: ahora })
      return c.json({ id })
    },
  )

  /** Detener un trabajo (faltan repuestos, falta la respuesta del cliente…): sale de la cola y queda a la vista con su motivo. */
  .post('/tareas/:id/detener', conDatos(z.object({ motivo: z.enum(claves(MOTIVOS_DETENCION)), nota: z.string().trim().max(300).optional() })), async (c) => {
    const { actor, ahora } = c.var
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    exigirTrabajo(c, t)
    if (t.status === 'done') throw rechazo(409, 'Ese trabajo ya está terminado.')
    const { motivo, nota } = c.req.valid('json')
    if (motivo === 'other' && (nota ?? '').length < 3) throw rechazo(400, 'Escribe por qué se detiene.')
    const f = await enSuRuta(c, t)
    if (f.situacion === 'held') throw rechazo(409, 'Ese trabajo ya está detenido.')
    await c.var.base.insert(taskHolds).values({ id: nuevoId('det'), tenantId: actor.tenantId, taskId: t.id, workOrderId: t.workOrderId, reason: motivo, note: nota || null, createdAt: ahora, createdBy: actor.id })
    return c.json({ ok: true })
  })

  .post('/tareas/:id/reanudar', async (c) => {
    const { actor, ahora } = c.var
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    exigirTrabajo(c, t)
    const r = await c.var.base
      .update(taskHolds)
      .set({ resolvedAt: ahora, resolvedBy: actor.id })
      .where(and(eq(taskHolds.taskId, t.id), eq(taskHolds.tenantId, actor.tenantId), isNull(taskHolds.resolvedAt)))
      .returning({ id: taskHolds.id })
    if (!r.length) throw rechazo(409, 'Ese trabajo no está detenido.')
    return c.json({ ok: true })
  })

  /** El jefe de taller deja empezar un trabajo antes de su turno (armar el block mientras la culata sigue en su sección). */
  .post('/tareas/:id/adelantar', async (c) => {
    exigirGestion(c)
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    if (t.status !== 'pending') throw rechazo(409, 'Ese trabajo ya se inició.')
    const f = await enSuRuta(c, t)
    if (f.situacion === 'held') throw rechazo(409, 'Ese trabajo está detenido: reanúdalo primero.')
    if (f.situacion === 'machine') throw rechazo(409, `La máquina está detenida: ${enumerar(f.maquinas)}. Sin máquina no se adelanta; se puede empezar cuando vuelva a operar.`)
    if (f.situacion !== 'waiting' && f.situacion !== 'parts') throw rechazo(409, 'Ese trabajo ya se puede empezar.')
    await c.var.base.update(workOrderTasks).set({ advancedAt: c.var.ahora, advancedBy: c.var.actor.id }).where(eq(workOrderTasks.id, t.id))
    return c.json({ ok: true })
  })

  /**
   * Asignar un trabajo. La pieza no cambia de manos dentro de la sección: lo que sigue de la misma pieza en la misma
   * sección, sin empezar y con la misma persona de antes, pasa también a la nueva.
   */
  .post('/tareas/:id/asignar', conDatos(z.object({ usuario: z.string().min(1, 'Elige a quién.').nullable() })), async (c) => {
    exigirGestion(c)
    const t = await filaDelTenant(c, workOrderTasks, c.req.param('id'), 'task', 'ese trabajo')
    if (t.status === 'done') throw rechazo(409, 'Ese trabajo ya está terminado.')
    const { usuario } = c.req.valid('json')
    if (usuario) {
      const u = await filaDelTenant(c, users, usuario, 'user', 'esa persona')
      if (u.status !== 'active' || u.role === 'viewer') throw rechazo(409, 'Esa persona no puede tomar trabajos.')
    }
    const resto = await c.var.base
      .select({ id: workOrderTasks.id })
      .from(workOrderTasks)
      .where(
        and(
          eq(workOrderTasks.workOrderId, t.workOrderId),
          eq(workOrderTasks.tenantId, c.var.actor.tenantId),
          eq(workOrderTasks.sectionId, t.sectionId),
          eq(workOrderTasks.piece, t.piece),
          eq(workOrderTasks.status, 'pending'),
          ne(workOrderTasks.id, t.id),
          t.assignedTo ? eq(workOrderTasks.assignedTo, t.assignedTo) : isNull(workOrderTasks.assignedTo),
        ),
      )
    await c.var.base.update(workOrderTasks).set({ assignedTo: usuario }).where(inArray(workOrderTasks.id, [t.id, ...resto.map((r) => r.id)]))
    return c.json({ ok: true, tambien: resto.length })
  })

  /**
   * El tablero del taller: por sección, lo que falta hacer de las OT en el taller. Primero lo que está en proceso,
   * después lo que se puede hacer ahora (atrasado, urgente, lo que vence antes), lo que espera su turno y lo detenido.
   */
  .get('/taller', conFiltros(z.object({ mias: z.literal('1').optional() })), async (c) => {
    const { base, actor, ahora } = c.var
    const { mias } = c.req.valid('query')
    const hoy = diaEnChile(ahora)
    const trabajos = await trabajosAbiertos(base, actor.tenantId)
    const { secciones } = await cargaDelTaller(base, actor.tenantId, trabajos)
    const nombres = await nombresDe(c)
    const tarjetas = trabajos
      .filter((f) => !mias || f.t.assignedTo === actor.id)
      .sort((a, b) => enCola(a, b, hoy))
      .map((f) => ({
        id: f.t.id,
        seccionId: f.t.sectionId,
        nombre: f.t.name,
        pieza: f.t.piece,
        estado: f.t.status,
        situacion: f.situacion,
        espera: f.espera,
        faltan: f.faltan,
        maquinas: f.maquinas,
        detencion: detencionVisible(f.detencion, nombres),
        horas: f.t.stdMinutes / 60,
        asignadoId: f.t.assignedTo,
        asignado: f.t.assignedTo ? (nombres.get(f.t.assignedTo) ?? null) : null,
        inicio: f.t.startedAt?.toISOString() ?? null,
        ot: { ...f.ot, plazo: plazoDeOt(f.ot.entrega, f.ot.estado, hoy) },
        cliente: f.cliente,
      }))
    return c.json({ secciones: secciones.map((s) => ({ ...s, tareas: tarjetas.filter((x) => x.seccionId === s.id) })) })
  })

  /**
   * El rendimiento del taller: los trabajos terminados en los últimos días, por actividad y por persona, con sus horas
   * estándar y las reales (en horario de taller, sin lo detenido). Con la hora real por unidad de cada actividad, para
   * afinar su hora estándar. Lo ven el jefe de taller y el administrador.
   */
  .get('/rendimiento', conFiltros(z.object({ dias: z.coerce.number().int().min(7).max(365).default(90) })), async (c) => {
    if (!gestiona(c.var.actor.rol)) throw rechazo(403, 'El rendimiento lo ven el jefe de taller y el administrador.')
    const { base, actor, ahora } = c.var
    const { dias } = c.req.valid('query')
    const desde = new Date(ahora.getTime() - dias * 86_400_000)
    const [hechos, detenciones, actividades, nombres] = await Promise.all([
      base
        .select({ id: workOrderTasks.id, servicio: workOrderTasks.serviceId, quien: workOrderTasks.finishedBy, cantidad: workOrderTasks.quantity, minutos: workOrderTasks.stdMinutes, inicio: workOrderTasks.startedAt, termino: workOrderTasks.finishedAt })
        .from(workOrderTasks)
        .where(and(eq(workOrderTasks.tenantId, actor.tenantId), eq(workOrderTasks.status, 'done'), gte(workOrderTasks.finishedAt, desde), isNotNull(workOrderTasks.startedAt))),
      // Las detenciones que pudieron tocar esos trabajos (un trabajo largo pudo detenerse antes del período).
      base.select({ tarea: taskHolds.taskId, desde: taskHolds.createdAt, hasta: taskHolds.resolvedAt }).from(taskHolds).where(and(eq(taskHolds.tenantId, actor.tenantId), gte(taskHolds.createdAt, new Date(desde.getTime() - 60 * 86_400_000)))),
      base.select({ id: services.id, codigo: services.code, nombre: services.name, unidad: services.unit, horas: services.stdHours }).from(services).where(eq(services.tenantId, actor.tenantId)),
      nombresDe(c),
    ])
    const detenidas = new Map<string, { desde: Date; hasta: Date | null }[]>()
    for (const d of detenciones) detenidas.set(d.tarea, [...(detenidas.get(d.tarea) ?? []), { desde: d.desde, hasta: d.hasta }])
    const medidos = hechos.map((t) => ({ ...t, estandar: t.minutos / 60, real: horasReales(t.inicio!, t.termino!, detenidas.get(t.id)) }))
    const agrupar = <K,>(clave: (t: (typeof medidos)[number]) => K | null) => {
      const grupos = new Map<K, typeof medidos>()
      for (const t of medidos) {
        const k = clave(t)
        if (k !== null) grupos.set(k, [...(grupos.get(k) ?? []), t])
      }
      return grupos
    }
    const porActividad = [...agrupar((t) => t.servicio)].flatMap(([id, lista]) => {
      const a = actividades.find((x) => x.id === id)
      return a ? [{ id, codigo: a.codigo, nombre: a.nombre, unidad: a.unidad, horasEstandar: a.horas, ...rendimientoDe(lista) }] : []
    })
    const porPersona = [...agrupar((t) => t.quien)].map(([id, lista]) => ({ id, nombre: nombres.get(id) ?? '—', ...rendimientoDe(lista) }))
    return c.json({
      dias,
      total: rendimientoDe(medidos),
      actividades: porActividad.sort((a, b) => b.trabajos - a.trabajos || a.codigo.localeCompare(b.codigo)),
      personas: porPersona.sort((a, b) => b.trabajos - a.trabajos || a.nombre.localeCompare(b.nombre, 'es')),
    })
  })

  /** Las personas que pueden tomar trabajos (para asignar), con las actividades que hace cada una. */
  .get('/personas', async (c) => {
    const lista = await c.var.base
      .select({ id: users.id, nombre: users.name, rol: users.role })
      .from(users)
      .where(and(eq(users.tenantId, c.var.actor.tenantId), eq(users.status, 'active'), ne(users.role, 'viewer')))
      .orderBy(asc(users.name))
    const suyas = await c.var.base.select({ servicioId: serviceSpecialists.serviceId, userId: serviceSpecialists.userId }).from(serviceSpecialists).where(eq(serviceSpecialists.tenantId, c.var.actor.tenantId))
    return c.json(lista.map((p) => ({ ...p, actividades: suyas.filter((e) => e.userId === p.id).map((e) => e.servicioId) })))
  })

  /** La carga del taller: por sección (con su gente) y por persona. */
  .get('/carga', async (c) => {
    const trabajos = await trabajosAbiertos(c.var.base, c.var.actor.tenantId)
    return c.json(await cargaDelTaller(c.var.base, c.var.actor.tenantId, trabajos))
  })

  /** Repartir lo que está sin asignar en una sección entre su gente, con las reglas de siempre. */
  .post('/secciones/:id/repartir', async (c) => {
    exigirGestion(c)
    const { base, actor } = c.var
    const s = await filaDelTenant(c, shopSections, c.req.param('id'), 'section', 'esa sección')
    const ots = await base
      .selectDistinct({ id: workOrderTasks.workOrderId })
      .from(workOrderTasks)
      .innerJoin(workOrders, eq(workOrders.id, workOrderTasks.workOrderId))
      .where(and(eq(workOrderTasks.tenantId, actor.tenantId), eq(workOrderTasks.sectionId, s.id), eq(workOrderTasks.status, 'pending'), isNull(workOrderTasks.assignedTo), inArray(workOrders.status, OT_EN_TALLER)))
    const antes = await sinAsignarEn(c, s.id)
    await base.transaction(async (tx) => {
      for (const ot of ots) await repartirOt(tx, actor.tenantId, ot.id, s.id)
    })
    return c.json({ ok: true, repartidos: antes - (await sinAsignarEn(c, s.id)) })
  })

  .get('/catalogo', async (c) => {
    const { base, actor } = c.var
    const secciones = await base.select().from(shopSections).where(eq(shopSections.tenantId, actor.tenantId)).orderBy(asc(shopSections.position))
    const trabajos = await base.select().from(services).where(eq(services.tenantId, actor.tenantId)).orderBy(asc(services.step), asc(services.code))
    const especialistas = await base.select({ servicioId: serviceSpecialists.serviceId, userId: serviceSpecialists.userId }).from(serviceSpecialists).where(eq(serviceSpecialists.tenantId, actor.tenantId))
    const montos = veMontos(actor.rol)
    return c.json({
      secciones: secciones.map((s) => ({ id: s.id, nombre: s.name, diagnostico: s.kind === 'diagnosis', activa: s.active })),
      trabajos: trabajos.map((t) => ({
        id: t.id,
        seccionId: t.sectionId,
        codigo: t.code,
        nombre: t.name,
        unidad: t.unit,
        criterio: t.criterion,
        precio: montos ? t.price : null,
        horas: t.stdHours,
        pieza: t.piece,
        paso: t.step,
        tipico: t.typical,
        activo: t.active,
        especialistas: especialistas.filter((e) => e.servicioId === t.id).map((e) => e.userId),
      })),
    })
  })

  /** Una actividad nueva: código automático, al final de la ruta de su pieza si no se dice otro paso. Solo el administrador. */
  .post('/catalogo', conDatos(actividadNueva), async (c) => {
    exigirAdministrador(c)
    const { base, actor } = c.var
    const d = c.req.valid('json')
    const seccion = await filaDelTenant(c, shopSections, d.seccionId, 'section', 'esa sección')
    if (!seccion.active) throw rechazo(409, SECCION_APAGADA)
    await exigirPiezas(c, [d.pieza], true)
    const propias = await piezasPropias(base, actor.tenantId)
    const id = nuevoId('srv')
    const codigo = await base.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`services:${actor.tenantId}`}))`)
      const lista = await tx.select({ codigo: services.code, seccionId: services.sectionId, pieza: services.piece, paso: services.step }).from(services).where(eq(services.tenantId, actor.tenantId))
      // La letra de la sección (la que ya usan sus actividades) y el número que sigue: C-07, B-07…
      const letra = lista.find((x) => x.seccionId === seccion.id)?.codigo.match(/^([A-Z]+)-/)?.[1] ?? seccion.name.normalize('NFD').replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase()
      const ultimo = Math.max(0, ...lista.map((x) => x.codigo.match(new RegExp(`^${letra}-(\\d+)$`))?.[1]).filter(Boolean).map(Number))
      const codigo = `${letra}-${String(ultimo + 1).padStart(2, '0')}`
      const paso = d.paso ?? Math.max(90, ...lista.filter((x) => x.pieza === d.pieza).map((x) => x.paso)) + 10
      await tx.insert(services).values({ id, tenantId: actor.tenantId, sectionId: seccion.id, code: codigo, name: d.nombre, unit: unidadDe(d.criterio, d.pieza, propias), criterion: d.criterio, price: d.precio, stdHours: d.horas, piece: d.pieza, step: paso, typical: d.tipico, active: true })
      return codigo
    })
    return c.json({ id, codigo })
  })

  /** Ajustar una actividad: nombre, sección, pieza, cómo se cuenta, valor, horas, su paso, el desglose o si se ofrece. Solo el administrador. */
  .post('/catalogo/:id', conDatos(actividad.partial().extend({ activo: z.boolean().optional() })), async (c) => {
    exigirAdministrador(c)
    const t = await filaDelTenant(c, services, c.req.param('id'), 'service', 'esa actividad')
    const d = c.req.valid('json')
    // Una actividad que se ofrece no queda en una sección apagada: ni al moverla ni al volver a encenderla.
    const otraSeccion = d.seccionId && d.seccionId !== t.sectionId ? await filaDelTenant(c, shopSections, d.seccionId, 'section', 'esa sección') : null
    if (d.activo === true || (otraSeccion && (d.activo ?? t.active))) {
      const [suya] = otraSeccion ? [otraSeccion] : await c.var.base.select().from(shopSections).where(and(eq(shopSections.id, t.sectionId), eq(shopSections.tenantId, c.var.actor.tenantId)))
      if (!suya?.active) throw rechazo(409, SECCION_APAGADA)
    }
    if (d.pieza !== undefined && d.pieza !== t.piece) await exigirPiezas(c, [d.pieza], true)
    const criterio = d.criterio ?? t.criterion
    const pieza = d.pieza ?? t.piece
    const propias = await piezasPropias(c.var.base, c.var.actor.tenantId)
    await c.var.base
      .update(services)
      .set({
        ...(d.nombre !== undefined ? { name: d.nombre } : {}),
        ...(d.seccionId !== undefined ? { sectionId: d.seccionId } : {}),
        ...(d.pieza !== undefined || d.criterio !== undefined ? { piece: pieza, criterion: criterio, unit: unidadDe(criterio, pieza, propias) } : {}),
        ...(d.precio !== undefined ? { price: d.precio } : {}),
        ...(d.horas !== undefined ? { stdHours: d.horas } : {}),
        ...(d.paso !== undefined ? { step: d.paso } : {}),
        ...(d.tipico !== undefined ? { typical: d.tipico } : {}),
        ...(d.activo !== undefined ? { active: d.activo } : {}),
      })
      .where(and(eq(services.id, t.id), eq(services.tenantId, c.var.actor.tenantId)))
    return c.json({ ok: true })
  })

  /** Quién hace una actividad. Lo deciden el jefe de taller y el administrador; los trabajos nuevos se reparten entre ellos. */
  .post('/catalogo/:id/especialistas', conDatos(z.object({ usuarios: z.array(z.string()).max(200) })), async (c) => {
    exigirGestion(c)
    const { actor, ahora } = c.var
    const t = await filaDelTenant(c, services, c.req.param('id'), 'service', 'esa actividad')
    const gente = await filasDelTenant(c, users, c.req.valid('json').usuarios, 'user', 'esa persona')
    if (gente.some((u) => u.status !== 'active' || u.role === 'viewer')) throw rechazo(409, 'Una actividad la hace quien puede tomar trabajos: no alguien bloqueado ni de solo lectura.')
    await c.var.base.transaction(async (tx) => {
      await tx.delete(serviceSpecialists).where(and(eq(serviceSpecialists.serviceId, t.id), eq(serviceSpecialists.tenantId, actor.tenantId)))
      if (gente.length) await tx.insert(serviceSpecialists).values(gente.map((u) => ({ tenantId: actor.tenantId, serviceId: t.id, userId: u.id, createdAt: ahora })))
    })
    return c.json({ ok: true })
  })

  /** Una sección nueva del taller (la de bombas inyectoras, la de turbos): va al final del tablero. Solo el administrador. */
  .post('/secciones', conDatos(z.object({ nombre: nombreSeccion })), async (c) => {
    exigirAdministrador(c)
    const { base, actor } = c.var
    const { nombre } = c.req.valid('json')
    await exigirSeccionLibre(c, nombre)
    const id = nuevoId('sec')
    await base.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`shop_sections:${actor.tenantId}`}))`)
      const [{ ultima }] = await tx.select({ ultima: sql<number>`coalesce(max(${shopSections.position}), -1)`.mapWith(Number) }).from(shopSections).where(eq(shopSections.tenantId, actor.tenantId))
      await tx.insert(shopSections).values({ id, tenantId: actor.tenantId, name: nombre, kind: 'work', position: ultima + 1, active: true })
    })
    return c.json({ id })
  })

  /**
   * Renombrar una sección, o apagarla cuando ya no tiene nada: ni actividades en uso ni trabajos por hacer. La de
   * recepción y diagnóstico no se apaga: ahí nace cada OT.
   */
  .post('/secciones/:id', conDatos(z.object({ nombre: nombreSeccion.optional(), activa: z.boolean().optional() })), async (c) => {
    exigirAdministrador(c)
    const { base, actor } = c.var
    const s = await filaDelTenant(c, shopSections, c.req.param('id'), 'section', 'esa sección')
    const d = c.req.valid('json')
    if (d.nombre && d.nombre !== s.name) await exigirSeccionLibre(c, d.nombre, s.id)
    if (d.activa === false && s.active) {
      if (s.kind === 'diagnosis') throw rechazo(409, 'La sección de recepción y diagnóstico no se apaga: ahí nace cada OT.')
      const [{ actividades }] = await base.select({ actividades: count() }).from(services).where(and(eq(services.tenantId, actor.tenantId), eq(services.sectionId, s.id), eq(services.active, true)))
      if (actividades) throw rechazo(409, `Tiene ${actividades === 1 ? 'una actividad' : `${actividades} actividades`} en uso: muévelas a otra sección o apágalas primero.`)
      const [{ trabajos }] = await base
        .select({ trabajos: count() })
        .from(workOrderTasks)
        .innerJoin(workOrders, eq(workOrders.id, workOrderTasks.workOrderId))
        .where(and(eq(workOrderTasks.tenantId, actor.tenantId), eq(workOrderTasks.sectionId, s.id), ne(workOrderTasks.status, 'done'), inArray(workOrders.status, OT_EN_TALLER)))
      if (trabajos) throw rechazo(409, `Tiene ${trabajos === 1 ? 'un trabajo' : `${trabajos} trabajos`} por hacer: se apaga cuando terminen.`)
    }
    await base
      .update(shopSections)
      .set({ ...(d.nombre ? { name: d.nombre } : {}), ...(d.activa !== undefined ? { active: d.activa } : {}) })
      .where(and(eq(shopSections.id, s.id), eq(shopSections.tenantId, actor.tenantId)))
    return c.json({ ok: true })
  })

  /** Subir o bajar una sección: es el orden de las columnas del tablero. */
  .post('/secciones/:id/mover', conDatos(z.object({ hacia: z.enum(['arriba', 'abajo']) })), async (c) => {
    exigirAdministrador(c)
    const { base, actor } = c.var
    const s = await filaDelTenant(c, shopSections, c.req.param('id'), 'section', 'esa sección')
    const { hacia } = c.req.valid('json')
    await base.transaction(async (tx) => {
      const todas = await tx.select({ id: shopSections.id }).from(shopSections).where(eq(shopSections.tenantId, actor.tenantId)).orderBy(asc(shopSections.position), asc(shopSections.name))
      const i = todas.findIndex((x) => x.id === s.id)
      const j = hacia === 'arriba' ? i - 1 : i + 1
      if (j < 0 || j >= todas.length) throw rechazo(409, hacia === 'arriba' ? 'Ya es la primera.' : 'Ya es la última.')
      ;[todas[i], todas[j]] = [todas[j], todas[i]]
      // Se numeran de nuevo todas, en el orden nuevo.
      for (const [posicion, x] of todas.entries()) await tx.update(shopSections).set({ position: posicion }).where(eq(shopSections.id, x.id))
    })
    return c.json({ ok: true })
  })

  .route('/', rutasPiezas)
  .route('/', rutasComercial)
  .route('/', rutasCompras)
  .route('/', rutasMaquinas)

async function sinAsignarEn(c: C, seccionId: string) {
  const [{ n }] = await c.var.base
    .select({ n: count() })
    .from(workOrderTasks)
    .innerJoin(workOrders, eq(workOrders.id, workOrderTasks.workOrderId))
    .where(and(eq(workOrderTasks.tenantId, c.var.actor.tenantId), eq(workOrderTasks.sectionId, seccionId), eq(workOrderTasks.status, 'pending'), isNull(workOrderTasks.assignedTo), inArray(workOrders.status, OT_EN_TALLER)))
  return n
}
