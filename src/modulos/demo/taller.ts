// El trabajo de un taller de demostración: sus clientes, quién hace cada actividad y 90 días de motores que entran, se
// diagnostican, se cotizan, se aprueban (o no), pasan por la ruta de cada pieza, por calidad y se entregan. Los
// repuestos aceptados se piden al proveedor (una orden de compra por proveedor, que el chofer va a buscar) o los trae el
// cliente, y el trabajo que los necesita empieza cuando llegan. Cada OT se arma con su línea de tiempo completa y
// después se corta a la hora de «ahora»: lo que no alcanzó a pasar queda por hacer, lo pedido sigue por retirar y lo
// detenido (el cliente no responde) sigue detenido.
import type { Linea } from '../comercial/reglas'
import { totales } from '../comercial/reglas'
import type { customers, quotes } from '../comercial/tablas'
import { digitoVerificador, formatoRut } from '../../rut'
import { claveDeProveedor, type QuienCompra } from '../compras/reglas'
import type { purchaseOrders, suppliers, supplies, supplyMovements, workOrderParts } from '../compras/tablas'
import { maquinasIniciales } from '../maquinas/reglas'
import type { machines, machineServices, machineStops } from '../maquinas/tablas'
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
  'B-05': [{ motivo: 'other', nota: 'La lineadora está en mantención hasta el jueves' }],
  'G-01': [{ motivo: 'customer', nota: 'El cliente debe aprobar el rectificado a 0,50' }],
  'A-01': [{ motivo: 'customer', nota: 'El cliente debe aprobar el cambio de bomba de aceite' }],
}
const EQUIPOS = ['Bus', 'Camión', 'Tracto', 'Excavadora', 'Cargador frontal', 'Tractor agrícola', 'Camioneta', 'Grupo electrógeno', 'Grúa horquilla']
const FALLAS = [
  'Consumo de aceite y humo azul', 'Pérdida de compresión en dos cilindros', 'Recalentamiento; culata con posible fisura', 'Golpe de biela',
  'Baja presión de aceite', 'Agua en el aceite', 'Fundió metales de bancada', 'Ruido en la distribución', 'Mantención mayor por horas de uso',
]
/** Los repuestos que se cotizan, con el trabajo que los espera si no es el armado (los cilindros se rectifican a la medida del pistón). */
const REPUESTOS: { descripcion: string; precio: number; necesita?: string; medida?: string; marca: string }[] = [
  { descripcion: 'Kit de pistones y anillos', precio: 420_000, necesita: 'B-01', medida: '0,50', marca: 'Mahle' }, { descripcion: 'Juego de metales de bancada y biela', precio: 180_000, medida: '0,25', marca: 'King' },
  { descripcion: 'Juego de empaquetaduras completo', precio: 150_000, marca: 'Victor Reinz' }, { descripcion: 'Bomba de aceite', precio: 210_000, marca: 'Melling' },
  { descripcion: 'Juego de válvulas de admisión y escape', precio: 160_000, necesita: 'C-06', medida: 'STD', marca: 'TRW' }, { descripcion: 'Camisas de cilindro (juego)', precio: 380_000, necesita: 'B-03', medida: 'STD', marca: 'Mahle' },
]
/** Los proveedores de cada taller de demostración: con quién se habla, dónde retira el chofer y qué vende. El último ya no se usa. */
const PROVEEDORES = [
  { nombre: 'Repuestos Diesel Sur', rut: 76_412_893, contacto: 'Rodrigo Sáez', telefono: '+56 41 229 4410', direccion: 'Av. Colón 3456, Talcahuano', nota: 'Pistones, anillos y camisas. Se paga a 30 días.', activo: true },
  { nombre: 'Importadora Motores del Pacífico', rut: 77_035_621, contacto: 'Carolina Muñoz', telefono: '+56 2 2786 1200', direccion: 'Camino a Melipilla 9870, Maipú', nota: 'Importa a pedido: demora de 3 a 5 días.', activo: true },
  { nombre: 'Distribuidora Pistones Chile', rut: 76_880_147, contacto: 'Hernán Olivares', telefono: '+56 9 8823 4471', direccion: 'San Pablo 2215, Santiago', nota: 'Kits de pistones y metales. Bodega hasta las 17:30.', activo: true },
  { nombre: 'Casa del Repuesto Pesado', rut: 78_201_559, contacto: 'Mónica Araya', telefono: '+56 41 231 7755', direccion: 'Paicaví 1580, Concepción', nota: 'Empaquetaduras, bombas y válvulas. Contado o transferencia.', activo: true },
  { nombre: 'Comercial Andes Motor', rut: 76_559_302, contacto: 'Sergio Pinto', telefono: '+56 9 7741 2086', direccion: 'Los Carrera 890, Concepción', nota: 'Cerró su local: ya no se le compra.', activo: false },
]

/** Lo que gasta un taller y no es de una OT, con su mínimo y su costo por unidad. */
const INSUMOS = [
  { nombre: 'Aceite de prueba de presión', unidad: 'litro', minimo: 20, costo: 4_500, marca: 'Mobil' },
  { nombre: 'Pasta de esmeril para válvulas', unidad: 'tarro', minimo: 4, costo: 7_900, marca: 'Permatex' },
  { nombre: 'Piedras de bruñir (juego)', unidad: 'juego', minimo: 2, costo: 38_000, marca: 'Sunnen' },
  { nombre: 'Desengrasante para lavado', unidad: 'litro', minimo: 40, costo: 2_300, marca: null },
  { nombre: 'Pintura de motor', unidad: 'litro', minimo: 8, costo: 12_500, marca: null },
  { nombre: 'Guaipe', unidad: 'kilo', minimo: 15, costo: 1_800, marca: null },
  { nombre: 'Sellante de silicona', unidad: 'unidad', minimo: 6, costo: 6_200, marca: 'Loctite' },
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
  proveedores: (typeof suppliers.$inferInsert)[]
  maquinas: (typeof machines.$inferInsert)[]
  usosMaquinas: (typeof machineServices.$inferInsert)[]
  paradas: (typeof machineStops.$inferInsert)[]
  insumos: (typeof supplies.$inferInsert)[]
  movimientosInsumo: (typeof supplyMovements.$inferInsert)[]
  ordenes: (typeof purchaseOrders.$inferInsert)[]
  repuestos: (typeof workOrderParts.$inferInsert)[]
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
  // El chofer de compras: el último técnico (en un taller chico, el jefe va a buscar los repuestos).
  const chofer = tecnicos.length > 1 ? tecnicos[tecnicos.length - 1] : (jefes[0] ?? activos[0])

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

  // La lista de proveedores del taller. Sus ids salen del id del taller, sin gastar azar: así lo demás se siembra igual.
  const proveedores: Taller['proveedores'] = PROVEEDORES.map((p, i) => ({
    id: `prv_${t.tenantId.slice(3)}${i}`,
    tenantId: t.tenantId,
    name: p.nombre,
    nameKey: claveDeProveedor(p.nombre),
    taxId: formatoRut(`${p.rut}${digitoVerificador(p.rut)}`),
    contact: p.contacto,
    phone: p.telefono,
    email: null,
    address: p.direccion,
    notes: p.nota,
    active: p.activo,
    createdBy: jefes[0]?.id ?? null,
    createdAt: t.creado,
  }))
  const vigentes = proveedores.filter((p) => p.active)

  // Las máquinas del taller, también sin gastar azar. La última mantención, repartida: a algunas ya les toca. En los
  // talleres que siguen trabajando, a veces la bruñidora está en mantención o la lineadora en falla.
  const sufijo = t.tenantId.slice(3)
  const semilla = [...t.tenantId].reduce((s, ch) => s + ch.charCodeAt(0), 0)
  let nMaquina = 0
  const hoyTexto = t.hoy.toISOString().slice(0, 10)
  const { maquinas, usos: usosMaquinas } = maquinasIniciales(t.tenantId, secciones, trabajos, () => `maq_${sufijo}${nMaquina++}`, hoyTexto)
  for (const [i, m] of maquinas.entries()) m.lastMaintenanceAt = new Date(t.hoy.getTime() - ((semilla + i * 37) % (m.maintenanceEveryDays + 25)) * DIA).toISOString().slice(0, 10)
  const paradas: Taller['paradas'] = []
  const parar = (nombre: string, reason: 'breakdown' | 'maintenance', note: string, horas: number) => {
    const m = maquinas.find((x) => x.name === nombre)
    if (m) paradas.push({ id: `par_${sufijo}${paradas.length}`, tenantId: t.tenantId, machineId: m.id, reason, note, startedAt: new Date(t.ahora.getTime() - horas * HORA), startedBy: jefes[0]?.id ?? null })
  }
  if (!t.nunca && !t.silencio && semilla % 3 === 0) parar('Bruñidora', 'maintenance', 'Cambio de piedras y aceite del cabezal', 6)
  // La bodega, también sin azar: un stock repartido desde el inventario inicial; a algunos insumos ya les toca pedir.
  const insumos: Taller['insumos'] = INSUMOS.map((x, i) => ({ id: `ins_${sufijo}${i}`, tenantId: t.tenantId, name: x.nombre, unit: x.unidad, brand: x.marca, minStock: x.minimo, stock: (semilla + i * 17) % (x.minimo * 3 + 1), unitCost: x.costo, supplierId: vigentes[i % vigentes.length].id, active: true, createdAt: t.creado }))
  const movimientosInsumo: Taller['movimientosInsumo'] = insumos.filter((s) => s.stock).map((s, i) => ({ id: `mov_${sufijo}${i}`, tenantId: t.tenantId, supplyId: s.id, quantity: s.stock!, kind: 'adjust' as const, note: 'Inventario inicial', createdBy: jefes[0]?.id ?? null, createdAt: t.creado }))
  if (!t.nunca && !t.silencio && semilla % 4 === 1) parar('Lineadora de bancada', 'breakdown', 'No avanza el carro; viene el técnico de la marca', 30)
  const proveedorDe = new Map(proveedores.map((p) => [p.name, p.id]))

  /** Una actividad cotizada, contada para este motor (por cilindro, válvula, biela, culata o una vez). */
  const lineaDe = (codigo: string, m: Motor): Linea => {
    const x = trabajo.get(codigo)!
    return { tipo: 'trabajo', trabajoId: x.id, seccionId: x.sectionId, codigo, descripcion: x.name, cantidad: cantidadSegun(x.criterion, m), precio: x.price ?? Math.round(entre(90, 260) * 1000), horas: x.stdHours, pieza: x.piece, criterio: x.criterion }
  }
  /** Un repuesto cotizado: lo compra la rectificadora (con su proveedor y su costo) o, a veces, lo trae el cliente. */
  const repuesto = (r: (typeof REPUESTOS)[number], cotizadas: Linea[]): Linea => {
    const cliente = azar() < 0.18
    const precio = Math.round((r.precio * (0.8 + azar() * 0.5)) / 1000) * 1000
    const proveedor = cliente ? null : uno(vigentes)
    return {
      tipo: 'repuesto',
      trabajoId: null,
      seccionId: null,
      codigo: null,
      descripcion: r.descripcion,
      cantidad: 1,
      precio: cliente ? null : precio,
      horas: 0,
      compra: cliente ? 'customer' : 'shop',
      proveedorId: proveedor?.id ?? null,
      proveedor: proveedor?.name ?? null,
      costo: cliente ? null : Math.round((precio * (0.6 + azar() * 0.15)) / 1000) * 1000,
      necesita: r.necesita && cotizadas.some((x) => x.codigo === r.necesita) ? r.necesita : null,
      medida: r.medida ?? null,
      marca: cliente ? null : r.marca,
    }
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
      for (const r of REPUESTOS.filter(() => azar() < 0.45)) l.push(repuesto(r, l))
    } else {
      if (piezas.includes('culata') && azar() < 0.35) l.push(repuesto(REPUESTOS[4], l))
      l.push(linea('Q-01'))
    }
    return l
  }

  const ots: Taller['ots'] = []
  const tareas: Taller['tareas'] = []
  const detenciones: Taller['detenciones'] = []
  const ordenes: Taller['ordenes'] = []
  const repuestosOt: Taller['repuestos'] = []
  let numeroOc = 0
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
    /** Cuándo llegan los repuestos que espera cada actividad de esta OT (por código). */
    const llegaPara = new Map<string, Date>()
    const hacer = (x: (typeof trabajos)[number], cantidad: number) => {
      const quien = quienHace(x)
      const repuestosListos = llegaPara.get(x.code)
      if (repuestosListos && repuestosListos > reloj) reloj = repuestosListos
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
      // Los repuestos: el jefe pide lo suyo en el día (a veces junta pedidos y espera hasta tres), una orden por proveedor
      // que el chofer trae en 1 a 4 días; lo del cliente llega en 1 a 5 días. Cada uno lo espera su trabajo: el que dice
      // la cotización, o el armado.
      const armado = (cotizados.find((c) => c.x.piece === 'motor' && c.x.sectionId !== diagnostico.id) ?? cotizados.at(-1))?.x.code
      const pedido = enJornada(new Date(respuesta.getTime() + (2 + azar() ** 2 * 70) * HORA))
      const llegaDe = new Map<string, Date>()
      const repuestosCot = lineas
        .filter((l) => l.tipo === 'repuesto')
        .map((l) => {
          const compra: QuienCompra = l.compra === 'customer' ? 'customer' : 'shop'
          const proveedor = l.proveedor ?? uno(vigentes).name
          if (compra === 'shop' && !llegaDe.has(proveedor)) llegaDe.set(proveedor, enJornada(new Date(pedido.getTime() + (1 + azar() * 3) * DIA)))
          const llega = compra === 'shop' ? llegaDe.get(proveedor)! : enJornada(new Date(respuesta.getTime() + (1 + azar() * 4) * DIA))
          const espera = l.necesita ?? armado
          if (espera && llega > (llegaPara.get(espera) ?? new Date(0))) llegaPara.set(espera, llega)
          return { l, compra, proveedor, llega, espera }
        })
      let finPiezas = respuesta
      for (const pieza of new Set(cotizados.filter((c) => c.x.piece !== 'motor').map((c) => c.x.piece))) {
        reloj = respuesta
        for (const c of cotizados.filter((c) => c.x.piece === pieza)) hacer(c.x, c.l.cantidad)
        if (reloj > finPiezas) finPiezas = reloj
      }
      reloj = finPiezas
      for (const c of cotizados.filter((c) => c.x.piece === 'motor')) hacer(c.x, c.l.cantidad)
      // Las órdenes de compra que alcanzaron a emitirse, y los repuestos de la OT con su estado de ahora.
      const ocDe = new Map<string, string>()
      if (pedido <= corte)
        for (const [proveedor, llega] of llegaDe) {
          const ocId = id('oc')
          const numeroDeOc = ++numeroOc
          const recibida = llega <= corte
          ocDe.set(proveedor, ocId)
          ordenes.push({ id: ocId, tenantId: t.tenantId, number: numeroDeOc, supplierId: proveedorDe.get(proveedor) ?? null, supplier: proveedor, driverId: chofer?.id ?? null, expectedAt: new Date(pedido.getTime() + 2 * DIA).toISOString().slice(0, 10), notes: null, status: recibida ? 'received' : 'open', createdBy: recibe.id, createdAt: pedido, receivedAt: recibida ? llega : null })
          contar(pedido, 'documentos')
          evento({ tenantId: t.tenantId, tipo: 'purchase_order.created', en: pedido, actorId: recibe.id, targetId: ocId, targetType: 'purchase_order', metadata: { numero: `OC-${String(numeroDeOc).padStart(4, '0')}`, proveedor } })
          if (recibida) evento({ tenantId: t.tenantId, tipo: 'purchase_order.received', en: llega, actorId: chofer?.id ?? recibe.id, targetId: ocId, targetType: 'purchase_order', metadata: { numero: `OC-${String(numeroDeOc).padStart(4, '0')}`, proveedor } })
        }
      for (const [posicion, r] of repuestosCot.entries()) {
        const tarea = trabajosOt.find((w) => w.tarea.serviceId === trabajo.get(r.espera ?? '')?.id)?.tarea
        const ocId = r.compra === 'shop' ? ocDe.get(r.proveedor) : undefined
        const recibido = r.llega <= corte && (r.compra === 'customer' || Boolean(ocId))
        repuestosOt.push({
          id: id('rep'),
          tenantId: t.tenantId,
          workOrderId: otId,
          quoteId: qId,
          description: r.l.descripcion,
          size: r.l.medida ?? null,
          brand: r.l.marca ?? null,
          quantity: r.l.cantidad,
          position: posicion,
          source: r.compra,
          supplierId: r.compra === 'shop' ? (proveedorDe.get(r.proveedor) ?? null) : null,
          supplier: r.compra === 'shop' ? r.proveedor : null,
          unitCost: r.l.costo ?? null,
          neededByTaskId: tarea?.id ?? null,
          status: recibido ? 'received' : ocId ? 'ordered' : 'pending',
          purchaseOrderId: ocId ?? null,
          createdBy: recibe.id,
          createdAt: respuesta,
          receivedAt: recibido ? r.llega : null,
          receivedBy: recibido ? (r.compra === 'shop' ? (chofer?.id ?? recibe.id) : recibe.id) : null,
        })
      }
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
  return { secciones, trabajos, clientes, ots, tareas, especialistas, detenciones, cotizaciones, proveedores, maquinas, usosMaquinas, paradas, insumos, movimientosInsumo, ordenes, repuestos: repuestosOt, porDia }
}
