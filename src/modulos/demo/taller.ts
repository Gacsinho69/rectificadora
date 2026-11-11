// El trabajo de un taller de demostración: sus clientes y 90 días de motores que entran, se diagnostican, se cotizan,
// se aprueban (o no), pasan por las secciones, por calidad y se entregan. Cada OT se arma con su línea de tiempo
// completa y después se corta a la hora de «ahora»: lo que no alcanzó a pasar queda por hacer.
import type { Linea } from '../comercial/reglas'
import { totales } from '../comercial/reglas'
import type { customers, quotes } from '../comercial/tablas'
import type { TipoEvento } from '../eventos/tipos'
import { tallerInicial } from '../taller/comun'
import { estadoDeOt, type Pieza } from '../taller/reglas'
import type { workOrders, workOrderTasks } from '../taller/tablas'
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
  { nombre: 'Mercedes-Benz OM 457', cil: 6 }, { nombre: 'Mercedes-Benz OM 926', cil: 6 }, { nombre: 'Mercedes-Benz OM 936', cil: 6 },
  { nombre: 'Cummins ISX15', cil: 6 }, { nombre: 'Cummins ISL 8.9', cil: 6 }, { nombre: 'Detroit DD15', cil: 6 }, { nombre: 'Volvo D13', cil: 6 },
  { nombre: 'Scania DC13', cil: 6 }, { nombre: 'Caterpillar C15', cil: 6 }, { nombre: 'Caterpillar 3306', cil: 6 }, { nombre: 'Navistar DT466', cil: 6 },
  { nombre: 'Isuzu 4HK1', cil: 4 }, { nombre: 'Hino J08E', cil: 6 }, { nombre: 'Toyota 1KD-FTV', cil: 4 }, { nombre: 'Nissan YD25', cil: 4 },
  { nombre: 'Hyundai D4CB', cil: 4 }, { nombre: 'Perkins 1104D', cil: 4 }, { nombre: 'John Deere 6068', cil: 6 },
]
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
  const quienTrabaja = () => (tecnicos.length ? uno(tecnicos) : uno(activos))

  const clientes: Taller['clientes'] = Array.from({ length: Math.min(EMPRESAS.length, 5 + Math.round(activos.length * 0.6)) }, (_, i) => {
    const particular = i % 7 === 6
    const nombre = particular ? `${uno(PERSONAS)} (particular)` : EMPRESAS[(i * 7 + entre(0, 3)) % EMPRESAS.length]
    return { id: id('cl'), tenantId: t.tenantId, name: nombre, taxId: particular ? null : `${entre(76, 79)}.${entre(100, 999)}.${entre(100, 999)}-${entre(0, 9)}`, contact: uno(PERSONAS), phone: `+56 9 ${entre(5000, 9999)} ${entre(1000, 9999)}`, email: null, createdAt: t.creado }
  }).filter((c, i, l) => l.findIndex((x) => x.name === c.name) === i)

  const linea = (codigo: string, cantidad = 1): Linea => {
    const x = trabajo.get(codigo)!
    return { tipo: 'trabajo', trabajoId: x.id, seccionId: x.sectionId, codigo, descripcion: x.name, cantidad, precio: x.price ?? Math.round(entre(90, 260) * 1000), horas: x.stdHours }
  }
  /** Lo que se cotiza según lo que llegó y lo que encontró el diagnóstico. */
  const cotizar = (piezas: Pieza[], cil: number): Linea[] => {
    const l: Linea[] = []
    const completo = piezas.includes('motor')
    if (completo || piezas.includes('culata')) {
      l.push(linea('D-04'), linea('C-01'), linea('C-02', cil * 2), linea('C-03', cil * 2))
      if (azar() < 0.4) l.push(linea('C-04', cil * 2))
      if (azar() < 0.15) l.push(linea('T-01'))
      l.push(linea('C-06'))
    }
    if (completo || piezas.includes('block')) {
      l.push(azar() < 0.3 ? linea('B-03', cil) : linea('B-01', cil), linea('B-02', cil))
      if (azar() < 0.4) l.push(linea('B-04'))
      if (azar() < 0.2) l.push(linea('B-05'))
    }
    if (completo || piezas.includes('cigüeñal')) {
      if (azar() < 0.15) l.push(linea('G-04'))
      l.push(linea('G-01'), linea('G-02'))
      if (azar() < 0.35) l.push(linea('G-03'))
      if (azar() < 0.1) l.push(linea('T-02'))
    }
    if (completo || piezas.includes('bielas')) l.push(linea('G-05', cil))
    if (completo) {
      l.push(linea('A-01'), linea('A-03'), linea('Q-01'))
      for (const r of REPUESTOS.filter(() => azar() < 0.45)) l.push({ tipo: 'repuesto', trabajoId: null, seccionId: null, codigo: null, descripcion: r.descripcion, cantidad: 1, precio: Math.round((r.precio * (0.8 + azar() * 0.5)) / 1000) * 1000, horas: 0 })
    } else l.push(linea('Q-01'))
    return l
  }

  const ots: Taller['ots'] = []
  const tareas: Taller['tareas'] = []
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
    const cliente = uno(clientes)
    const sorteo = azar()
    const piezas: Pieza[] = sorteo < 0.55 ? ['motor'] : sorteo < 0.72 ? ['culata'] : sorteo < 0.85 ? ['block', 'cigüeñal'] : sorteo < 0.93 ? ['cigüeñal'] : ['cigüeñal', 'bielas']
    const urgente = azar() < 0.12
    const otId = id('ot')
    const numero = ++numeroOt
    const recibe = quienRecibe()
    const entrega = new Date(recibida.getTime() + (urgente ? entre(4, 6) : entre(7, 15)) * DIA)
    let posicion = 0

    // Diagnóstico: desarme y medición (motor o block) o prueba de fisuras (piezas sueltas).
    const conDesarme = piezas.includes('motor') || piezas.includes('block')
    let reloj = new Date(recibida.getTime() + (2 + azar() * 20) * HORA)
    const trabajosOt: { tarea: Taller['tareas'][number]; fin: Date }[] = []
    const hacer = (codigo: string, nombre: string, seccionId: string, cantidad: number, horas: number, servicio: string | null) => {
      const inicio = enJornada(new Date(reloj.getTime() + azar() * 5 * HORA))
      const fin = enJornada(new Date(inicio.getTime() + Math.max(1, horas * cantidad) * (1.2 + azar() * 1.3) * HORA))
      reloj = fin
      const quien = quienTrabaja()
      const tarea = {
        id: id('tar'),
        tenantId: t.tenantId,
        workOrderId: otId,
        sectionId: seccionId,
        serviceId: servicio,
        name: cantidad === 1 ? nombre : `${nombre} ×${cantidad}`,
        quantity: cantidad,
        stdMinutes: Math.round(horas * cantidad * 60),
        position: posicion++,
        status: 'pending' as const,
        assignedTo: azar() < 0.6 ? quien.id : null,
        startedAt: null as Date | null,
        finishedAt: null as Date | null,
        finishedBy: null as string | null,
      }
      if (inicio <= corte) Object.assign(tarea, { status: 'in_progress', startedAt: inicio, assignedTo: quien.id })
      if (fin <= corte) Object.assign(tarea, { status: 'done', finishedAt: fin, finishedBy: quien.id })
      tareas.push(tarea)
      trabajosOt.push({ tarea, fin })
      return fin
    }
    for (const codigo of conDesarme ? ['D-01', 'D-02'] : ['D-03']) {
      const x = trabajo.get(codigo)!
      hacer(codigo, x.name, diagnostico.id, 1, x.stdHours, x.id)
    }

    // Cotización: al terminar el diagnóstico; se envía ese día o el siguiente; el cliente responde en unos días.
    const lineas = cotizar(piezas, motor.cil)
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

    // Aprobada: los trabajos pasan a su sección, uno tras otro; después calidad y entrega.
    let calidad: Date | null = null
    let entregada: Date | null = null
    let anulada: Date | null = null
    if (estadoCot === 'accepted') {
      // Las secciones trabajan en paralelo: culatas, block, cigüeñal y terceros a la vez; el armado espera a todas y
      // el control de calidad, al armado. Dentro de una sección, un trabajo tras otro.
      const cotizados = lineas.filter((x) => x.tipo === 'trabajo')
      let inicioFase = respuesta
      for (const fase of [[0, 1, 2, 3, 6], [4], [5]]) {
        let finFase = inicioFase
        for (const s of fase) {
          reloj = inicioFase
          for (const l of cotizados.filter((x) => x.seccionId === secciones[s].id)) hacer(l.codigo!, l.descripcion, l.seccionId!, l.cantidad, l.horas, l.trabajoId)
          if (reloj > finFase) finFase = reloj
        }
        inicioFase = finFase
      }
      reloj = inicioFase
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
  return { secciones, trabajos, clientes, ots, tareas, cotizaciones, porDia }
}
