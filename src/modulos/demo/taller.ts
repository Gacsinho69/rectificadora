// El trabajo de un taller de demostración: sus clientes, quién hace cada actividad y 90 días de motores que entran, se
// diagnostican, se cotizan, se aprueban (o no), pasan por la ruta de cada pieza, por calidad y se entregan. Cada OT se
// arma con su línea de tiempo completa y después se corta a la hora de «ahora»: lo que no alcanzó a pasar queda por
// hacer, y lo que estaba detenido (faltan repuestos, el cliente no responde) sigue detenido.
import type { Linea } from '../comercial/reglas'
import { totales } from '../comercial/reglas'
import type { customers, quotes } from '../comercial/tablas'
import type { TipoEvento } from '../eventos/tipos'
import { tallerInicial } from '../taller/comun'
import { cantidadSegun, estadoDeOt, type Motor, type MotivoDetencion, nombreDeTarea, type Pieza } from '../taller/reglas'
import type { serviceSpecialists, taskHolds, workOrders, workOrderTasks } from '../taller/tablas'
import type { RolTenant } from '../usuarios/reglas'

const DIA = 86_400_000
const HORA = 3_600_000

/** Lleva un momento al horario del taller (8 a 19 h de Chile, UTC−3): lo que cae fuera pasa a las 8 del día siguiente. */
function enJornada(d: Date) {
  const local = new Date(d.getTime() - 3 * HORA)
  const h = local.getUTCHours() + local.getUTCMinutes() / 60
  if (h < 8) return new Date(d.getTime() + (8 - h) * HORA)
  if (h >= 19) return new Date(d.getTime() + (32 - h) * HORA)
  return d
}

const EMPRESAS = [
  'Transportes Cordillera', 'Buses Costa Norte', 'Agrícola Los Robles', 'Constructora Vial Sur', 'Pesquera Bahía Azul', 'Áridos del Valle',
  'Forestal Los Coigües', 'Camiones Ríos Hermanos', 'Minera Cerro Gris', 'Transportes Pacheco', 'Logística Austral', 'Buses Interurbanos del Sur',
  'Maquinarias Andinas', 'Grúas San Pedro', 'Transportes Frío Sur', 'Agroindustrial Valle Central', 'Municipalidad (flota)', 'Taller Mecánico El Pistón',
  'Repuestos y Motores Ltda.', 'Constructora Altamira', 'Transportes Ñuble', 'Sociedad Agrícola Santa Elena', 'Buses Rurales Unidos', 'Camiones del Norte',
]
const PERSONAS = ['Juan Pérez', 'Luis Carrasco', 'Marcela Ruiz', 'Pedro Gallardo', 'Héctor Bravo', 'Ana Vergara']
const MOTORES = [
  { nombre: 'Mercedes-Benz OM 457', cil: 6, val: 4 }, { nombre: 'Mercedes-Benz OM 926', cil: 6, val: 4 }, { nombre: 'Mercedes-Benz OM 936', cil: 6, val: 4 },
  { nombre: 'Cummins ISX15', cil: 6, val: 4 }, { nombre: 'Cummins ISL 8.9', cil: 6, val: 4 }, { nombre: 'Detroit DD15', cil: 6, val: 4 }, { nombre: 'Volvo D13', cil: 6, val: 4 },
  { nombre: 'Scania DC13', cil: 6, val: 4 }, { nombre: 'Caterpillar C15', cil: 6, val: 4 }, { nombre: 'Caterpillar 3306', cil: 6, val: 2 }, { nombre: 'Navistar DT466', cil: 6, val: 2 },
  { nombre: 'Isuzu 4HK1', cil: 4, val: 4 }, { nombre: 'Hino J08E', cil: 6, val: 4 }, { nombre: 'Toyota 1KD-FTV', cil: 4, val: 4 }, { nombre: 'Nissan YD25', cil: 4, val: 4 },
  { nombre: 'Hyundai D4CB', cil: 4, val: 4 }, { nombre: 'Perkins 1104D', cil: 4, val: 2 }, { nombre: 'John Deere 6068', cil: 6, val: 2 },
]

/**
 * Quién hace qué en el taller de demostración: un desarmador, un culatero, el del block, el de cigüeñales y bielas y
 * un armador (con más técnicos, de a dos; con menos, uno hace varias cosas). El jefe de taller mide, aprueba la calidad
 * y lleva lo de terceros.
 */
const OFICIOS: { codigos: string[]; area: number | 'jefe'; tambien?: number | 'jefe' }[] = [
  { codigos: ['D-01', 'D-03'], area: 0 },
  { codigos: ['D-02'], area: 'jefe', tambien: 0 },
  { codigos: ['D-04', 'C-01', 'C-02', 'C-03', 'C-04', 'C-05', 'C-06'], area: 1 },
  { codigos: ['B-01', 'B-02', 'B-03', 'B-04', 'B-05', 'B-06'], area: 2 },
  { codigos: ['G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'G-06'], area: 3 },
  { codigos: ['A-01', 'A-02', 'A-03'], area: 4, tambien: 0 },
  { codigos: ['Q-01', 'T-01', 'T-02', 'T-03'], area: 'jefe' },
]

/** Lo que a veces se detiene antes de empezar, por qué y qué se anota. */
const DETENCIONES: Record<string, { motivo: MotivoDetencion; nota: string }[]> = {
  'B-01': [{ motivo: 'parts', nota: 'Pistones sobremedida 0,50: llegan el jueves' }, { motivo: 'parts', nota: 'Esperando el kit de pistones del proveedor' }],
  'B-03': [{ motivo: 'parts', nota: 'Camisas pedidas al proveedor' }],
  'C-04': [{ motivo: 'parts', nota: 'Guías de válvula pedidas' }],
  'G-01': [{ motivo: 'customer', nota: 'El cliente debe aprobar el rectificado a 0,50' }],
  'A-01': [{ motivo: 'parts', nota: 'Falta el juego de empaquetaduras' }, { motivo: 'customer', nota: 'El cliente debe aprobar el cambio de bomba de aceite' }],
}
const EQUIPOS = ['Bus', 'Camión', 'Tracto', 'Excavadora', 'Cargador frontal', 'Tractor agrícola', 'Camioneta', 'Grupo electrógeno', 'Grúa horquilla']
const FALLAS = [
  'Consumo de aceite y humo azul', 'Pérdida de compresión en dos cilindros', 'Recalentamiento; culata con posible fisura', 'Golpe de biela',
  'Baja presión de aceite', 'Agua en el aceite', 'Fundió metales de bancada', 'Ruido en la distribución', 'Mantención mayor por horas de uso',
]
const REPUESTOS = [
  { descripcion: 'Kit de pistones y anillos', precio: 420_000 }, { descripcion: 'Juego de metales de bancada y biela', precio: 180_000 },
  { descripcion: 'Juego de empaquetaduras completo', precio: 150_000 }, { descripcion: 'Bomba de aceite', precio: 210_000 },
  { descripcion: 'Juego de válvulas de admisión y escape', precio: 160_000 }, { descripcion: 'Camisas de cilindro (juego)', precio: 380_000 },
]

type Ayudas = { azar: () => number; entre: (a: number, b: number) => number; uno: <T>(l: readonly T[]) => T; id: (p: string) => string }
type Persona = { id: string; role: RolTenant; status: string }
type Evento = (e: { tenantId: string; tipo: TipoEvento; en: Date; actorId?: string | null; targetId?: string; targetType?: string; metadata?: Record<string, unknown> }) => void

export type Taller = {
  secciones: ReturnType<typeof tallerInicial>['secciones']
  trabajos: ReturnType<typeof tallerInicial>['trabajos']
  clientes: (typeof customers.$inferInsert)[]
  ots: (typeof workOrders.$inferInsert)[]
  tareas: (typeof workOrderTasks.$inferInsert)[]
  especialistas: (typeof serviceSpecialists.$inferInsert)[]
  detenciones: (typeof taskHolds.$inferInsert)[]
  cotizaciones: (typeof quotes.$inferInsert)[]
  /** Por día (AAAA-MM-DD): OT recibidas, cotizaciones creadas y documentos emitidos (cotizaciones enviadas y entregas). */
  porDia: Map<string, { ots: number; cotizaciones: number; documentos: number }>
}

export function sembrarTaller(
  a: Ayudas,
  t: { tenantId: string; creado: Date; hoy: Date; ahora: Date; silencio: number; nunca: boolean; actividad: number; personas: Persona[] },
  evento: Evento,
): Taller {
  const { azar, entre, uno, id } = a
  const { secciones, trabajos } = tallerInicial(t.tenantId, id, () => 0.85 + azar() * 0.35)
  const trabajo = new Map(trabajos.map((x) => [x.code, x]))
  const diagnostico = secciones[0]

  // Lo que pasó después del silencio no pasó: el taller dejó de usar el sistema ese día.
  const corte = t.silencio ? new Date(t.hoy.getTime() - t.silencio * DIA + 9 * HORA) : t.ahora
  const activos = t.personas.filter((p) => p.status === 'active')
  const tecnicos = activos.filter((p) => p.role === 'technician')
  const jefes = activos.filter((p) => p.role === 'planner' || p.role === 'admin')
  const quienRecibe = () => (jefes.length ? uno(jefes) : uno(activos))

  // Los especialistas de cada actividad, por oficio.
  const delOficio = (area: number | 'jefe') => {
    if (area === 'jefe') return jefes.length ? jefes.filter((_, i) => i < 2) : activos.slice(0, 1)
    if (!tecnicos.length) return jefes.length ? [jefes[0]] : activos.slice(0, 1)
    const suyos = tecnicos.filter((_, i) => i % 5 === area)
    return suyos.length ? suyos : [tecnicos[area % tecnicos.length]]
  }
  const hacenDe = new Map<string, string[]>()
  for (const o of OFICIOS)
    for (const codigo of o.codigos) {
      const gente = [...delOficio(o.area), ...(o.tambien !== undefined ? delOficio(o.tambien) : [])]
      hacenDe.set(trabajo.get(codigo)!.id, [...new Set(gente.map((g) => g.id))])
    }
  const especialistas: Taller['especialistas'] = [...hacenDe].flatMap(([serviceId, gente]) => gente.map((userId) => ({ tenantId: t.tenantId, serviceId, userId, createdAt: t.creado })))

  const clientes: Taller['clientes'] = Array.from({ length: Math.min(EMPRESAS.length, 5 + Math.round(activos.length * 0.6)) }, (_, i) => {
    const particular = i % 7 === 6
    const nombre = particular ? `${uno(PERSONAS)} (particular)` : EMPRESAS[(i * 7 + entre(0, 3)) % EMPRESAS.length]
    return { id: id('cl'), tenantId: t.tenantId, name: nombre, taxId: particular ? null : `${entre(76, 79)}.${entre(100, 999)}.${entre(100, 999)}-${entre(0, 9)}`, contact: uno(PERSONAS), phone: `+56 9 ${entre(5000, 9999)} ${entre(1000, 9999)}`, email: null, createdAt: t.creado }
  }).filter((c, i, l) => l.findIndex((x) => x.name === c.name) === i)

  /** Una actividad cotizada, contada para este motor (por cilindro, válvula, biela, culata o una vez). */
  const lineaDe = (codigo: string, m: Motor): Linea => {
    const x = trabajo.get(codigo)!
    return { tipo: 'trabajo', trabajoId: x.id, seccionId: x.sectionId, codigo, descripcion: x.name, cantidad: cantidadSegun(x.criterion, m), precio: x.price ?? Math.round(entre(90, 260) * 1000), horas: x.stdHours, pieza: x.piece, criterio: x.criterion }
  }
  /** Lo que se cotiza según lo que llegó y lo que encontró el diagnóstico, pieza por pieza. */
  const cotizar = (piezas: Pieza[], m: Motor): Linea[] => {
    const linea = (codigo: string) => lineaDe(codigo, m)
    const l: Linea[] = []
    const completo = piezas.includes('motor')
    if (completo) l.push(linea('D-01'), linea('D-02'))
    if (completo || piezas.includes('culata')) {
      l.push(linea('D-04'), linea('C-01'), linea('C-02'), linea('C-03'))
      if (azar() < 0.4) l.push(linea('C-04'))
      if (azar() < 0.15) l.push(linea('T-01'))
      l.push(linea('C-06'))
    }
    if (completo || piezas.includes('block')) {
      l.push(azar() < 0.3 ? linea('B-03') : linea('B-01'), linea('B-02'))
      if (azar() < 0.4) l.push(linea('B-04'))
      if (azar() < 0.2) l.push(linea('B-05'))
    }
    if (completo || piezas.includes('cigüeñal')) {
      if (azar() < 0.15) l.push(linea('G-04'))
      l.push(linea('G-01'), linea('G-02'))
      if (azar() < 0.35) l.push(linea('G-03'))
      if (azar() < 0.1) l.push(linea('T-02'))
    }
    if (completo || piezas.includes('bielas')) l.push(linea('G-05'))
    if (completo) {
      l.push(linea('A-01'), linea('A-03'), linea('Q-01'))
      for (const r of REPUESTOS.filter(() => azar() < 0.45)) l.push({ tipo: 'repuesto', trabajoId: null, seccionId: null, codigo: null, descripcion: r.descripcion, cantidad: 1, precio: Math.round((r.precio * (0.8 + azar() * 0.5)) / 1000) * 1000, horas: 0 })
    } else l.push(linea('Q-01'))
    return l
  }

  const ots: Taller['ots'] = []
  const tareas: Taller['tareas'] = []
  const detenciones: Taller['detenciones'] = []
  const cotizaciones: Taller['cotizaciones'] = []
  const porDia: Taller['porDia'] = new Map()
  const contar = (en: Date, campo: 'ots' | 'cotizaciones' | 'documentos') => {
    if (en > corte) return
    const d = en.toISOString().slice(0, 10)
    const x = porDia.get(d) ?? { ots: 0, cotizaciones: 0, documentos: 0 }
    x[campo]++
    porDia.set(d, x)
  }
  const ya = (d: Date | null | undefined) => (d && d <= corte ? d : null)

  const ritmo = Math.max(0.25, activos.length * 0.11) * (0.6 + t.actividad * 0.6)
  const dias = Math.min(89, Math.floor((t.hoy.getTime() - t.creado.getTime()) / DIA))
  let numeroOt = 0
  let numeroCot = 0
  const recibidas: { en: Date }[] = []
  for (let d = dias; d >= 0; d--) {
    const dia = new Date(t.hoy.getTime() - d * DIA)
    const semana = dia.getUTCDay()
    if (t.nunca || semana === 0) continue
    const n = Math.floor(ritmo * (semana === 6 ? 0.4 : 1) * (0.5 + azar()) + azar())
    for (let k = 0; k < n; k++) recibidas.push({ en: new Date(dia.getTime() + (11 + azar() * 9) * HORA) })
  }

  for (const { en: recibida } of recibidas.sort((x, y) => x.en.getTime() - y.en.getTime())) {
    if (recibida > corte) continue
    const motor = uno(MOTORES)
    const medidas: Motor = { cilindros: motor.cil, valvulasPorCilindro: motor.val, culatas: 1 }
    const cliente = uno(clientes)
    const sorteo = azar()
    const piezas: Pieza[] = sorteo < 0.55 ? ['motor'] : sorteo < 0.72 ? ['culata'] : sorteo < 0.85 ? ['block', 'cigüeñal'] : sorteo < 0.93 ? ['cigüeñal'] : ['cigüeñal', 'bielas']
    const urgente = azar() < 0.12
    const otId = id('ot')
    const numero = ++numeroOt
    const recibe = quienRecibe()
    const entrega = new Date(recibida.getTime() + (urgente ? entre(4, 6) : entre(7, 15)) * DIA)
    let posicion = 0

    // Diagnóstico: desarme y medición (motor o block) o prueba de fisuras (piezas sueltas, y la hidráulica si viene la culata).
    const conDesarme = piezas.includes('motor') || piezas.includes('block')
    const diagnosticos = conDesarme ? ['D-01', 'D-02'] : ['D-03', ...(piezas.includes('culata') ? ['D-04'] : [])]
    let reloj = new Date(recibida.getTime() + (2 + azar() * 20) * HORA)
    const trabajosOt: { tarea: Taller['tareas'][number]; fin: Date }[] = []
    /** A uno de quienes hacen la actividad: al que ya tiene esa pieza de la OT, si también la hace. */
    const quienHace = (x: (typeof trabajos)[number]) => {
      const gente = hacenDe.get(x.id) ?? []
      const conLaPieza = trabajosOt.find((w) => w.tarea.piece === x.piece && w.tarea.assignedTo && gente.includes(w.tarea.assignedTo))
      return conLaPieza?.tarea.assignedTo ?? (gente.length ? uno(gente) : null)
    }
    const hacer = (x: (typeof trabajos)[number], cantidad: number) => {
      const quien = quienHace(x)
      const listo = reloj
      // A veces se detiene antes de empezar (los pistones no han llegado) y espera días a que se resuelva.
      const posible = DETENCIONES[x.code]
      const detencion = posible && azar() < 0.18 ? { ...uno(posible), desde: enJornada(new Date(listo.getTime() + azar() * 3 * HORA)), dias: 1 + azar() * 3 } : null
      const hasta = detencion ? enJornada(new Date(detencion.desde.getTime() + detencion.dias * DIA)) : null
      const inicio = enJornada(new Date(Math.max(reloj.getTime() + azar() * 5 * HORA, hasta?.getTime() ?? 0)))
      const fin = enJornada(new Date(inicio.getTime() + Math.max(1, x.stdHours * cantidad) * (1.2 + azar() * 1.3) * HORA))
      reloj = fin
      const tarea = {
        id: id('tar'),
        tenantId: t.tenantId,
        workOrderId: otId,
        sectionId: x.sectionId,
        serviceId: x.id,
        name: nombreDeTarea(x.name, cantidad, x.criterion),
        quantity: cantidad,
        stdMinutes: Math.round(x.stdHours * cantidad * 60),
        position: posicion++,
        piece: x.piece,
        step: x.step,
        status: 'pending' as const,
        assignedTo: quien,
        startedAt: null as Date | null,
        finishedAt: null as Date | null,
        finishedBy: null as string | null,
      }
      if (inicio <= corte) Object.assign(tarea, { status: 'in_progress', startedAt: inicio })
      if (fin <= corte) Object.assign(tarea, { status: 'done', finishedAt: fin, finishedBy: quien })
      if (detencion && hasta && detencion.desde <= corte)
        detenciones.push({ id: id('det'), tenantId: t.tenantId, taskId: tarea.id, workOrderId: otId, reason: detencion.motivo, note: detencion.nota, createdAt: detencion.desde, createdBy: quien, resolvedAt: hasta <= corte ? hasta : null, resolvedBy: hasta <= corte ? quien : null })
      tareas.push(tarea)
      trabajosOt.push({ tarea, fin })
      return fin
    }
    for (const codigo of diagnosticos) hacer(trabajo.get(codigo)!, cantidadSegun(trabajo.get(codigo)!.criterion, medidas))

    // Cotización: al terminar el diagnóstico; se envía ese día o el siguiente; el cliente responde en unos días.
    const lineas = cotizar(piezas, medidas)
    const descuento = azar() < 0.25 ? uno([5, 10]) : 0
    const tot = totales(lineas, descuento)
    const creada = enJornada(new Date(reloj.getTime() + azar() * 6 * HORA))
    const enviada = enJornada(new Date(creada.getTime() + azar() * 20 * HORA))
    const respuesta = enJornada(new Date(enviada.getTime() + (8 + azar() * 96) * HORA))
    const sorteoRespuesta = azar()
    const acepta = sorteoRespuesta < 0.78
    const qId = id('cot')
    const qNumero = ++numeroCot
    const estadoCot = !ya(creada) ? null : !ya(enviada) ? 'draft' : !ya(respuesta) ? 'sent' : acepta ? 'accepted' : 'rejected'
    if (estadoCot) {
      cotizaciones.push({
        id: qId,
        tenantId: t.tenantId,
        number: qNumero,
        customerId: cliente.id,
        workOrderId: otId,
        engine: motor.nombre,
        cylinders: medidas.cilindros,
        valvesPerCylinder: medidas.valvulasPorCilindro,
        heads: medidas.culatas,
        lines: lineas,
        discountPct: descuento,
        net: tot.neto,
        tax: tot.iva,
        total: tot.total,
        status: estadoCot,
        createdBy: recibe.id,
        createdAt: creada,
        sentAt: ya(enviada),
        decidedAt: estadoCot === 'accepted' || estadoCot === 'rejected' ? respuesta : null,
        decisionNote: estadoCot === 'rejected' ? uno(['El cliente encontró un motor de recambio', 'Precio sobre su presupuesto', 'Decidió dar de baja el equipo']) : null,
      })
      contar(creada, 'cotizaciones')
      if (ya(enviada)) {
        contar(enviada, 'documentos')
        evento({ tenantId: t.tenantId, tipo: 'quote.sent', en: enviada, actorId: recibe.id, targetId: qId, targetType: 'quote', metadata: { numero: qNumero, total: tot.total } })
      }
      if (estadoCot === 'accepted' || estadoCot === 'rejected')
        evento({ tenantId: t.tenantId, tipo: estadoCot === 'accepted' ? 'quote.accepted' : 'quote.rejected', en: respuesta, actorId: recibe.id, targetId: qId, targetType: 'quote', metadata: { numero: qNumero, total: tot.total } })
    }

    // Aprobada: desarmado, cada pieza sigue su ruta (un paso tras otro, a la vez que las otras piezas); el armado y el
    // control final, lo de toda la OT, esperan a todas. Lo que ya se hizo en el diagnóstico no se repite.
    let calidad: Date | null = null
    let entregada: Date | null = null
    let anulada: Date | null = null
    if (estadoCot === 'accepted') {
      const cotizados = lineas
        .filter((x) => x.tipo === 'trabajo' && !diagnosticos.includes(x.codigo!))
        .map((l) => ({ l, x: trabajo.get(l.codigo!)! }))
        .sort((a, b) => a.x.step - b.x.step)
      let finPiezas = respuesta
      for (const pieza of new Set(cotizados.filter((c) => c.x.piece !== 'motor').map((c) => c.x.piece))) {
        reloj = respuesta
        for (const c of cotizados.filter((c) => c.x.piece === pieza)) hacer(c.x, c.l.cantidad)
        if (reloj > finPiezas) finPiezas = reloj
      }
      reloj = finPiezas
      for (const c of cotizados.filter((c) => c.x.piece === 'motor')) hacer(c.x, c.l.cantidad)
      calidad = enJornada(new Date(reloj.getTime() + (2 + azar() * 20) * HORA))
      entregada = enJornada(new Date(calidad.getTime() + (4 + azar() * 60) * HORA))
    } else if (estadoCot === 'rejected') {
      anulada = enJornada(new Date(respuesta.getTime() + (4 + azar() * 40) * HORA))
    }
    const listaCalidad = ya(calidad) && trabajosOt.every((x) => x.tarea.status === 'done') ? calidad : null
    const listaEntrega = listaCalidad && ya(entregada) ? entregada : null
    const listaAnulacion = ya(anulada)
    const estado = estadoDeOt({
      anulada: Boolean(listaAnulacion),
      entregada: Boolean(listaEntrega),
      calidadAprobada: Boolean(listaCalidad),
      tareas: trabajosOt.map((x) => ({ diagnostico: x.tarea.sectionId === diagnostico.id, estado: x.tarea.status })),
      cotizacion: estadoCot,
    })
    ots.push({
      id: otId,
      tenantId: t.tenantId,
      number: numero,
      customerId: cliente.id,
      quoteId: estadoCot && estadoCot !== 'draft' ? qId : null,
      engine: motor.nombre,
      engineSerial: `${entre(100, 999)}${entre(100000, 999999)}`,
      cylinders: medidas.cilindros,
      valvesPerCylinder: medidas.valvulasPorCilindro,
      heads: medidas.culatas,
      equipment: azar() < 0.8 ? `${uno(EQUIPOS)} ${String.fromCharCode(65 + entre(0, 25), 65 + entre(0, 25))}${String.fromCharCode(65 + entre(0, 25), 65 + entre(0, 25))}-${entre(10, 99)}` : null,
      pieces: piezas,
      complaint: uno(FALLAS),
      priority: urgente ? 'urgent' : 'normal',
      dueDate: entrega.toISOString().slice(0, 10),
      status: estado,
      createdBy: recibe.id,
      createdAt: recibida,
      qcApprovedAt: listaCalidad,
      qcApprovedBy: listaCalidad ? recibe.id : null,
      deliveredAt: listaEntrega,
      deliveredTo: listaEntrega ? cliente.contact : null,
      cancelledAt: listaAnulacion,
      cancelReason: listaAnulacion ? 'El cliente no aprobó la cotización; se devolvió sin reparar' : null,
    })
    contar(recibida, 'ots')
    evento({ tenantId: t.tenantId, tipo: 'work_order.created', en: recibida, actorId: recibe.id, targetId: otId, targetType: 'work_order', metadata: { numero, motor: motor.nombre, piezas } })
    if (listaEntrega) {
      contar(listaEntrega, 'documentos')
      evento({ tenantId: t.tenantId, tipo: 'work_order.closed', en: listaEntrega, actorId: recibe.id, targetId: otId, targetType: 'work_order', metadata: { numero, recibe: cliente.contact } })
    }
    if (listaAnulacion) evento({ tenantId: t.tenantId, tipo: 'work_order.cancelled', en: listaAnulacion, actorId: recibe.id, targetId: otId, targetType: 'work_order', metadata: { numero, motivo: 'Cotización rechazada' } })
  }
  return { secciones, trabajos, clientes, ots, tareas, especialistas, detenciones, cotizaciones, porDia }
}
