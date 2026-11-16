// Una orden de trabajo. Arriba, lo que falta para entregarla (la fecha que no alcanza, la cotización sin respuesta, los
// repuestos por pedir, lo detenido), y cuándo se entrega. Después, sus trabajos pieza por pieza en el orden de su ruta,
// con quién los tiene y en qué están (lo que se contesta en el mesón); sus repuestos; el motor y el cliente, la
// cotización y la historia.
import { PrinterOutlined, RightOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Table } from 'antd'
import dayjs from 'dayjs'
import { Fragment, useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Problema } from '../../../pantallas/componentes'
import { fecha, fechaHora, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { SelectorDeProveedor } from '../../compras/pantallas/Proveedores'
import { margenDe, QUIEN_COMPRA, type QuienCompra, referenciaDe } from '../../compras/reglas'
import { cantidadSegun, MOTIVOS_DETENCION, nombreDeGrupo, type Pieza, PRIORIDADES_OT, type Situacion } from '../reglas'
import { usePiezas } from './Piezas'
import { CamposDelMotor, comoSeCuenta, cuandoSeEntrega, diasHasta, enQueEsta, enumerar, EstadoCotTag, EstadoOtTag, EstadoRepuestoTag, folioCot, folioOt, horas, motorDeDatos, textoEspera, textoMaquinas, textoMotor, usePersona, usePortal } from './comun'
import type { Catalogo, DetalleOt, Persona, PiezaDeOt, RepuestoDeOt, Tarea } from './tipos'
import { FichaTrabajo } from './FichaTrabajo'
import { BotonesDeTarea, useAccionesDeTarea } from './Trabajo'

const ruta = getRouteApi('/c/$portal/ot/$id')

/** Lo que frena una OT, dicho como se dice en el taller, con su marca de color y adónde ir para resolverlo. */
type Pendiente = { tono: 'rojo' | 'naranjo' | 'gris' | 'azul' | 'verde'; que: string; detalle?: string; ir?: () => void }

/** Un día (`2026-11-21`) a mediodía, para mostrarlo con `fecha` sin que la zona horaria lo corra. */
const diaIso = (d: string) => `${d}T12:00:00Z`
const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`
const irA = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

export function OrdenDeTrabajo() {
  const { id } = ruta.useParams()
  const portal = usePortal()
  const { persona, gestiona, veMontos, trabaja, suspendida } = usePersona()
  const pz = usePiezas()
  const ir = useNavigate()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [dialogo, setDialogo] = useState<'trabajo' | 'repuesto' | 'editar' | 'entregar' | 'anular' | null>(null)
  const [ficha, setFicha] = useState<string | null>(null)
  const r = useQuery({ queryKey: ['taller', 'ot', id], queryFn: () => api<DetalleOt>('GET', `/servicio/ot/${id}`) })
  const sugerida = useQuery({ queryKey: ['taller', 'ot', id, 'entrega-sugerida'], queryFn: () => api<{ fecha: string; dias: number } | null>('GET', `/servicio/ot/${id}/entrega-sugerida`) })
  const personas = useQuery({ queryKey: ['taller', 'personas'], queryFn: () => api<Persona[]>('GET', '/servicio/personas'), enabled: gestiona })
  const tarea = useAccionesDeTarea()
  const recibir = useMutation({
    mutationFn: (repuestoId: string) => api('POST', `/servicio/repuestos/${repuestoId}/recibir`),
    onSuccess: () => {
      message.success('Repuesto recibido: el trabajo que lo esperaba ya puede seguir.')
      return consultas.invalidateQueries({ queryKey: ['taller'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
  const calidad = useMutation({
    mutationFn: () => api('POST', `/servicio/ot/${id}/calidad`),
    onSuccess: () => {
      message.success('Control de calidad aprobado: lista para entregar.')
      return consultas.invalidateQueries({ queryKey: ['taller'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const ot = r.data
  const abierta = ot.estado !== 'delivered' && ot.estado !== 'cancelled'
  const puede = gestiona && !suspendida && abierta
  const cotizacionVigente = ot.cotizaciones.find((q) => q.estado === 'accepted' || q.estado === 'sent' || q.estado === 'draft')
  const soloDiagnostico = ot.tareas.every((t) => t.diagnostico)
  const enTaller = ot.estado === 'received' || ot.estado === 'diagnosis' || ot.estado === 'waiting_approval' || ot.estado === 'in_progress'
  const cotizar = () => ir({ to: '/c/$portal/cotizaciones/$id', params: { portal, id: 'nueva' }, search: { ot: ot.id } })
  const pendientes = abierta
    ? queFalta(ot, { gestiona, veMontos, sugerida: sugerida.data, vigente: cotizacionVigente, editar: () => setDialogo('editar'), cotizar, verCotizacion: (q) => ir({ to: '/c/$portal/cotizaciones/$id', params: { portal, id: q } }) })
    : []
  const terminados = ot.tareas.filter((t) => t.estado === 'done').length
  const horasTotal = ot.tareas.reduce((s, t) => s + t.horas, 0)
  const horasFaltan = ot.tareas.reduce((s, t) => s + (t.estado === 'done' ? 0 : t.horas), 0)
  const entrega = ot.estado === 'ready' ? { texto: 'Lista para entregar' } : cuandoSeEntrega(ot.entrega)
  const diasEnTaller = Math.max(0, Math.round(((ot.entregada ? Date.parse(ot.entregada) : Date.now()) - Date.parse(ot.creada)) / 86_400_000))

  return (
    <>
      <Encabezado
        miga={<Link to="/c/$portal/ot" params={{ portal }}>Órdenes de trabajo</Link>}
        titulo={
          <>
            <span className="folio">{folioOt(ot.numero)}</span>
            {ot.cliente.nombre}
          </>
        }
        sub={
          <>
            <EstadoOtTag estado={ot.estado} />
            {ot.prioridad === 'urgent' && abierta && <span className="estado rojo">Urgente</span>}
            <span>{ot.motor}</span>
            {ot.equipo && <span>{ot.equipo}</span>}
          </>
        }
        acciones={
          <>
            {puede && ot.estado === 'quality' && (
              <Button type="primary" loading={calidad.isPending} onClick={() => calidad.mutate()}>
                Aprobar control de calidad
              </Button>
            )}
            {puede && ot.estado === 'ready' && (
              <Button type="primary" onClick={() => setDialogo('entregar')}>
                Entregar
              </Button>
            )}
            {puede && veMontos && !cotizacionVigente && (
              <Button type={ot.estado === 'quality' || ot.estado === 'ready' ? 'default' : 'primary'} onClick={cotizar}>
                Cotizar
              </Button>
            )}
            {(ot.estado === 'ready' || ot.estado === 'delivered') && (
              <Link to="/c/$portal/ot/$id/acta" params={{ portal, id: ot.id }}>
                <Button icon={<PrinterOutlined />}>Acta de entrega</Button>
              </Link>
            )}
            {puede && <Button onClick={() => setDialogo('editar')}>Editar</Button>}
            {puede && (
              <Button type="text" danger onClick={() => setDialogo('anular')}>
                Anular
              </Button>
            )}
          </>
        }
      />
      {ot.estado === 'cancelled' && <Alert type="warning" showIcon className="problema" title={`Anulada ${fechaHora(ot.anulada)}`} description={ot.motivoAnulacion} />}
      {ot.estado === 'delivered' && <Alert type="success" showIcon className="problema" title={`Entregada ${fechaHora(ot.entregada)} a ${ot.entregadaA ?? '—'}`} />}

      {abierta && (
        <section className="atencion" aria-labelledby="falta-titulo">
          <h2 id="falta-titulo">{pendientes.length ? 'Qué falta' : 'Nada la frena'}</h2>
          {pendientes.length ? (
            <ul>
              {pendientes.map((p) => {
                const contenido = (
                  <>
                    <span className="atencion-texto">
                      <b>{p.que}</b>
                      {p.detalle && <small>{p.detalle}</small>}
                    </span>
                    {p.ir && <RightOutlined className="atencion-flecha" />}
                  </>
                )
                return (
                  <li key={p.que}>
                    {p.ir ? (
                      <button type="button" className={`atencion-fila ${p.tono}`} onClick={p.ir}>
                        {contenido}
                      </button>
                    ) : (
                      <div className={`atencion-fila fija ${p.tono}`}>{contenido}</div>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="atencion-vacia">{textoSinPendientes(ot)}</p>
          )}
        </section>
      )}

      <Cifras
        cifras={[
          {
            rotulo: 'Entrega',
            valor: ot.estado === 'delivered' ? fecha(ot.entregada) : ot.estado === 'cancelled' ? '—' : entrega.texto,
            tono: abierta && 'tono' in entrega ? entrega.tono : ot.estado === 'ready' ? 'verde' : undefined,
            nota: ot.estado === 'delivered' ? `a ${ot.entregadaA ?? '—'}` : !ot.entrega ? 'sin fecha comprometida' : 'tono' in entrega && entrega.tono ? `comprometida para el ${fecha(diaIso(ot.entrega))}` : `en ${diasHasta(ot.entrega)} días`,
          },
          {
            rotulo: 'Trabajos',
            valor: `${terminados} de ${ot.tareas.length}`,
            nota: soloDiagnostico && ot.tareas.length ? 'de diagnóstico, terminados' : 'terminados',
          },
          abierta && horasFaltan > 0 && { rotulo: 'Falta', valor: horas(Math.round(horasFaltan * 10) / 10), nota: `de ${horas(Math.round(horasTotal * 10) / 10)} estimadas` },
          {
            rotulo: ot.entregada ? 'Estuvo en el taller' : 'En el taller',
            valor: diasEnTaller === 1 ? '1 día' : `${diasEnTaller} días`,
            nota: `recibida el ${fecha(ot.creada)}`,
          },
        ]}
      />

      <section className="bloque" id="trabajos">
        <header>
          <h2>Trabajos</h2>
          {puede && ot.estado !== 'ready' && (
            <div className="bloque-extra">
              <Button onClick={() => setDialogo('trabajo')}>Agregar trabajo</Button>
            </div>
          )}
        </header>
        <TrabajosPorPieza
          ot={ot}
          piezas={pz}
          acciones={abierta && ot.estado !== 'ready' && ot.estado !== 'waiting_approval'}
          asignar={gestiona && abierta}
          personas={personas.data}
          cargandoPersonas={personas.isPending}
          yo={persona?.id}
          gestiona={gestiona}
          trabaja={trabaja && !suspendida}
          tarea={tarea}
          abrir={setFicha}
        />
        {soloDiagnostico && ot.estado !== 'cancelled' && (
          <p className="tenue ot-nota-pie">Cuando se apruebe la cotización, sus trabajos aparecen aquí, cada uno en la ruta de su pieza y con su especialista.</p>
        )}
      </section>

      {(ot.repuestos.length > 0 || (puede && enTaller)) && (
        <Bloque id="repuestos" titulo="Repuestos" extra={<>{veMontos && <MargenRepuestos repuestos={ot.repuestos} />}{puede && enTaller ? <Button onClick={() => setDialogo('repuesto')}>Agregar repuesto</Button> : null}</>}>
          <Table<RepuestoDeOt>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={ot.repuestos}
            scroll={{ x: 760 }}
            locale={{ emptyText: 'Sin repuestos. Los cotizados aparecen aquí al aceptar la cotización.' }}
            columns={[
              { title: 'Repuesto', key: 'n', render: (_, r) => <div className="fila-nombre"><span>{r.descripcion}</span>{referenciaDe(r) && <small>{referenciaDe(r)}</small>}{r.necesita && <small>Lo espera: {r.necesita}</small>}</div> },
              { title: 'Cantidad', dataIndex: 'cantidad', align: 'right', width: 90, render: (v: number) => <span className="cifra-tabla">{v}</span> },
              { title: 'Lo compra', key: 'c', width: 190, render: (_, r) => <div className="fila-nombre"><span>{QUIEN_COMPRA[r.compra]}</span>{r.proveedor && <small>{r.proveedor}</small>}</div> },
              { title: 'Estado', key: 'e', width: 170, render: (_, r) => <div className="fila-nombre"><span><EstadoRepuestoTag compra={r.compra} estado={r.estado} /></span>{r.oc && <small>{r.oc}</small>}{r.deBodega && <small>de bodega</small>}</div> },
              { title: 'Llegó', dataIndex: 'recibido', width: 130, render: (v: string | null) => (v ? fecha(v) : <span className="tenue">—</span>) },
              {
                title: '',
                key: 'x',
                width: 1,
                render: (_, r) =>
                  puede && (r.estado === 'pending' || r.estado === 'ordered') ? (
                    <Button size="small" loading={recibir.isPending && recibir.variables === r.id} onClick={() => recibir.mutate(r.id)} title={r.compra === 'customer' ? 'El cliente lo trajo' : 'Llegó al taller'}>
                      Recibido
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Bloque>
      )}

      <div className="columnas">
        <div>
          <Bloque titulo="El motor y el cliente">
            <dl className="ficha">
              <dt>Cliente</dt>
              <dd>
                {ot.cliente.nombre}
                {ot.cliente.contacto && <small className="ficha-nota">{ot.cliente.contacto}</small>}
                {ot.cliente.telefono && (
                  <small className="ficha-nota">
                    <a href={`tel:${ot.cliente.telefono.replace(/[^+\d]/g, '')}`}>{ot.cliente.telefono}</a>
                  </small>
                )}
              </dd>
              <dt>Motor</dt>
              <dd>{ot.motor}</dd>
              <dt>Llegó</dt>
              <dd>{ot.piezas.map(pz.nombre).join(', ')}</dd>
              <dt>Medidas</dt>
              <dd>{textoMotor(ot) ?? <span className="tenue">Sin datos: se cuenta como 4 cilindros, 2 válvulas por cilindro y 1 culata</span>}</dd>
              <dt>N° de motor</dt>
              <dd>{ot.numeroMotor ? <span className="cifra-tabla">{ot.numeroMotor}</span> : <span className="tenue">—</span>}</dd>
              <dt>Equipo</dt>
              <dd>{ot.equipo ?? <span className="tenue">—</span>}</dd>
              <dt>Falla informada</dt>
              <dd>{ot.falla ?? <span className="tenue">—</span>}</dd>
            </dl>
          </Bloque>
          {veMontos && (
            <Bloque titulo="Cotización">
              {ot.cotizaciones.length ? (
                <ul className="lista-ot">
                  {ot.cotizaciones.map((q) => (
                    <li key={q.id}>
                      <Link to="/c/$portal/cotizaciones/$id" params={{ portal, id: q.id }} className="fila-ot">
                        <span className="fila-ot-quien">
                          <b className="folio-fila">{folioCot(q.numero)}</b>
                          <small>{q.enviada ? `enviada el ${fecha(q.enviada)}` : 'sin enviar'}</small>
                        </span>
                        <span className="fila-ot-estado">
                          <EstadoCotTag estado={q.estado} />
                        </span>
                        <span className="fila-ot-cuando cifra-tabla">{plata(q.total)}</span>
                        <RightOutlined className="atencion-flecha" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tenue" style={{ margin: 0 }}>Sin cotización todavía. Se cotiza cuando el diagnóstico dice qué hay que hacer.</p>
              )}
            </Bloque>
          )}
        </div>
        <Historia historia={ot.historia} />
      </div>
      {dialogo === 'trabajo' && <AgregarTrabajo ot={ot} cerrar={() => setDialogo(null)} />}
      {dialogo === 'repuesto' && <AgregarRepuesto ot={ot} veMontos={veMontos} cerrar={() => setDialogo(null)} />}
      {dialogo === 'editar' && <Editar ot={ot} cerrar={() => setDialogo(null)} />}
      {dialogo === 'entregar' && <Entregar otId={ot.id} contacto={ot.cliente.contacto} cerrar={() => setDialogo(null)} />}
      {dialogo === 'anular' && <Anular otId={ot.id} cerrar={() => setDialogo(null)} />}
      {ficha && <FichaTrabajo id={ficha} cerrar={() => setFicha(null)} />}
    </>
  )
}

/**
 * Lo que falta para entregar la OT, de lo más grave a lo de rutina: la fecha que ya no alcanza, el diagnóstico o la
 * cotización pendiente, los repuestos por pedir o por llegar, lo detenido y lo que nadie tiene asignado.
 */
function queFalta(
  ot: DetalleOt,
  o: { gestiona: boolean; veMontos: boolean; sugerida: { fecha: string } | null | undefined; vigente: DetalleOt['cotizaciones'][number] | undefined; editar: () => void; cotizar: () => void; verCotizacion: (id: string) => void },
): Pendiente[] {
  const l: Pendiente[] = []
  const trabajos = () => irA('trabajos')
  const repuestos = () => irA('repuestos')
  const pendientesDe = (filtro: (t: Tarea) => boolean) => ot.tareas.filter((t) => t.estado !== 'done' && filtro(t))

  if (o.sugerida && ot.entrega && o.sugerida.fecha > ot.entrega && ot.estado !== 'quality' && ot.estado !== 'ready') {
    l.push({
      tono: 'rojo',
      que: `Con la cola de hoy sale el ${fecha(diaIso(o.sugerida.fecha))}`,
      detalle: `Se comprometió para el ${fecha(diaIso(ot.entrega))}. Avísale al cliente y cambia la fecha, o adelanta sus trabajos.`,
      ir: o.gestiona ? o.editar : undefined,
    })
  }

  const diagnostico = ot.tareas.filter((t) => t.diagnostico)
  const diagnosticoHecho = diagnostico.filter((t) => t.estado === 'done').length
  if ((ot.estado === 'received' || ot.estado === 'diagnosis') && diagnosticoHecho < diagnostico.length) {
    l.push({ tono: 'gris', que: 'Falta terminar el diagnóstico', detalle: `${diagnosticoHecho} de ${diagnostico.length} trabajos de recepción hechos.`, ir: trabajos })
  } else if (ot.tareas.every((t) => t.diagnostico) && ot.estado !== 'quality' && ot.estado !== 'ready') {
    if (!o.vigente) {
      if (o.veMontos) l.push({ tono: 'azul', que: 'Falta cotizar', detalle: 'El diagnóstico está hecho. Con la cotización aceptada, sus trabajos pasan al taller.', ir: o.cotizar })
      else l.push({ tono: 'gris', que: 'Falta cotizar', detalle: 'El diagnóstico está hecho; la cotización la hace la oficina.' })
    } else if (o.vigente.estado === 'draft') {
      l.push({ tono: 'azul', que: `La ${folioCot(o.vigente.numero)} está sin enviar`, detalle: 'Mándasela al cliente para que la apruebe.', ir: o.veMontos ? () => o.verCotizacion(o.vigente!.id) : undefined })
    } else if (o.vigente.estado === 'sent') {
      l.push({
        tono: 'gris',
        que: 'El cliente no ha respondido la cotización',
        detalle: `${folioCot(o.vigente.numero)}${o.vigente.enviada ? `, enviada el ${fecha(o.vigente.enviada)}` : ''}.${ot.cliente.telefono ? ` Teléfono: ${ot.cliente.telefono}.` : ''}`,
        ir: o.veMontos ? () => o.verCotizacion(o.vigente!.id) : undefined,
      })
    }
  }

  const porPedir = ot.repuestos.filter((r) => r.compra === 'shop' && r.estado === 'pending')
  const delCliente = ot.repuestos.filter((r) => r.compra === 'customer' && r.estado === 'pending')
  const pedidos = ot.repuestos.filter((r) => r.estado === 'ordered')
  const nombres = (rs: RepuestoDeOt[]) => (rs.length > 3 ? `${rs.slice(0, 3).map((r) => r.descripcion).join(', ')} y ${rs.length - 3} más` : enumerar(rs.map((r) => r.descripcion)))
  if (porPedir.length) l.push({ tono: 'naranjo', que: cuantos(porPedir.length, 'repuesto por pedir', 'repuestos por pedir'), detalle: `${nombres(porPedir)}.`, ir: repuestos })
  if (delCliente.length) l.push({ tono: 'naranjo', que: `El cliente tiene que traer ${cuantos(delCliente.length, 'repuesto', 'repuestos')}`, detalle: `${nombres(delCliente)}.`, ir: repuestos })
  if (pedidos.length) l.push({ tono: 'gris', que: `${cuantos(pedidos.length, 'repuesto pedido', 'repuestos pedidos')}, sin llegar`, detalle: `${nombres(pedidos)}.`, ir: repuestos })

  const detenidos = pendientesDe((t) => t.situacion === 'held')
  if (detenidos.length) {
    l.push({
      tono: 'naranjo',
      que: cuantos(detenidos.length, 'trabajo detenido', 'trabajos detenidos'),
      detalle: detenidos.map((t) => `${t.nombre}${t.detencion ? `: ${MOTIVOS_DETENCION[t.detencion.motivo].toLowerCase()}${t.detencion.nota ? ` (${t.detencion.nota})` : ''}` : ''}`).join(' · '),
      ir: trabajos,
    })
  }
  const sinMaquina = pendientesDe((t) => t.situacion === 'machine')
  if (sinMaquina.length) {
    l.push({ tono: 'naranjo', que: `${cuantos(sinMaquina.length, 'trabajo espera', 'trabajos esperan')} una máquina detenida`, detalle: textoMaquinas([...new Set(sinMaquina.flatMap((t) => t.maquinas))]), ir: trabajos })
  }
  const sinAsignar = pendientesDe((t) => t.situacion === 'available' && !t.asignadoId)
  if (o.gestiona && sinAsignar.length) {
    l.push({ tono: 'gris', que: `${cuantos(sinAsignar.length, 'trabajo', 'trabajos')} para empezar sin nadie asignado`, detalle: enumerar(sinAsignar.map((t) => t.nombre)), ir: trabajos })
  }

  if (ot.estado === 'quality') l.push({ tono: 'azul', que: 'Falta el control de calidad', detalle: 'Todos los trabajos están terminados. Revisa el motor y apruébalo para dejarlo listo.' })
  if (ot.estado === 'ready') {
    const quien = [ot.cliente.contacto, ot.cliente.telefono].filter(Boolean).join(', ')
    l.push({ tono: 'verde', que: 'Falta que el cliente la retire', detalle: quien ? `Avísale a ${quien}.` : 'Avísale al cliente.' })
  }
  const peso = { rojo: 0, naranjo: 1, azul: 2, gris: 3, verde: 4 }
  return l.sort((a, b) => peso[a.tono] - peso[b.tono])
}

/** Cuando nada la frena: en qué va, en una frase. */
function textoSinPendientes(ot: DetalleOt) {
  const trabajando = ot.tareas.filter((t) => t.situacion === 'in_progress').length
  const paraEmpezar = ot.tareas.filter((t) => t.situacion === 'available').length
  const partes = [trabajando && `${cuantos(trabajando, 'trabajo', 'trabajos')} en proceso`, paraEmpezar && `${cuantos(paraEmpezar, 'trabajo', 'trabajos')} para empezar`].filter(Boolean)
  return partes.length ? `Va bien: ${enumerar(partes as string[])}.` : 'Va bien: sus trabajos siguen su ruta.'
}

/**
 * Los trabajos de la OT, pieza por pieza y en el orden de su ruta. Cada pieza abre con cómo va (cuánto lleva y qué la
 * tiene ocupada); las que ya están listas quedan cerradas para que se vea lo que falta. Una fila por trabajo: qué es,
 * quién lo tiene, en qué está (con su detalle a la vista), sus horas y el botón que corresponde. Tocarla abre su ficha.
 */
function TrabajosPorPieza(p: {
  ot: DetalleOt
  piezas: ReturnType<typeof usePiezas>
  acciones: boolean
  asignar: boolean
  personas: Persona[] | undefined
  cargandoPersonas: boolean
  yo: string | undefined
  gestiona: boolean
  trabaja: boolean
  tarea: ReturnType<typeof useAccionesDeTarea>
  abrir: (id: string) => void
}) {
  const { ot } = p
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({})
  if (!ot.tareas.length) return <p className="lista-panel-vacia">Sin trabajos todavía.</p>
  const grupos: { clave: string; nombre: string; situacion: Situacion; hechas: number; total: number; avance: number; resumen: string; tareas: Tarea[] }[] = []
  for (const t of ot.tareas) {
    let g = grupos.find((x) => x.clave === t.grupo)
    if (!g) {
      const info = ot.porPieza.find((x) => x.clave === t.grupo)
      g = { clave: t.grupo, nombre: info?.nombre ?? nombreDeGrupo(t.grupo, p.piezas.propias), situacion: info?.situacion ?? 'waiting', hechas: 0, total: 0, avance: 0, resumen: info ? resumenDePieza(info) : '', tareas: [] }
      grupos.push(g)
    }
    g.tareas.push(t)
    g.total++
    if (t.estado === 'done') g.hechas++
  }
  for (const g of grupos) {
    g.avance = g.total ? g.hechas / g.total : 0
    if (g.hechas === g.total) {
      g.situacion = 'done'
      g.resumen = 'Lista'
    }
  }
  // Las listas se cierran solo si queda algo por hacer en otra pieza: en una OT terminada se ve todo.
  const quedaAlgo = grupos.some((g) => g.situacion !== 'done')
  const abierta = (g: (typeof grupos)[number]) => abiertas[g.clave] ?? !(quedaAlgo && g.situacion === 'done')
  /** Para asignar: primero quienes hacen esa actividad. */
  const opcionesDe = (t: Tarea) => {
    const lista = p.personas ?? []
    const hacen = lista.filter((x) => t.actividadId && x.actividades.includes(t.actividadId))
    const otras = lista.filter((x) => !hacen.includes(x))
    return [
      ...(hacen.length ? [{ label: 'Hacen esta actividad', options: hacen.map((x) => ({ value: x.id, label: x.nombre })) }] : []),
      { label: hacen.length ? 'Otras personas' : 'Personas', options: otras.map((x) => ({ value: x.id, label: x.nombre })) },
    ]
  }
  const sinAprobar = ot.estado === 'waiting_approval'
  return (
    <div className="ot-trabajos">
      <div className="ot-fila ot-encabezado" aria-hidden>
        <span>Trabajo</span>
        <span>Quién</span>
        <span>En qué está</span>
        <span>Horas</span>
        <span />
      </div>
      {grupos.map((g) => {
        const visible = abierta(g)
        return (
          <Fragment key={g.clave}>
            <button type="button" className={`ot-pieza ${g.situacion}`} aria-expanded={visible} onClick={() => setAbiertas((a) => ({ ...a, [g.clave]: !visible }))}>
              <RightOutlined className="ot-pieza-flecha" />
              <span className="ot-pieza-nombre">{g.nombre}</span>
              <span className="ot-pieza-cuenta">
                {g.hechas} de {g.total}
              </span>
              <span className={`medidor-barra ${g.situacion === 'done' ? 'verde' : 'azul'} ot-pieza-barra`}>
                <span style={{ width: `${Math.round(g.avance * 100)}%` }} />
              </span>
              <span className="ot-pieza-resumen">{g.resumen}</span>
            </button>
            {visible &&
              g.tareas.map((t) => {
                const esta = enQueEsta(t, sinAprobar)
                const detalle = t.estado === 'done' ? (t.termino ? `terminó el ${fecha(t.termino)}` : undefined) : esta.detalle
                return (
                  <div
                    key={t.id}
                    id={`t-${t.id}`}
                    className={`ot-fila${t.estado === 'done' ? ' hecha' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => p.abrir(t.id)}
                    onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && p.abrir(t.id)}
                    title="Abrir la ficha del trabajo"
                  >
                    <span className="ot-fila-que">
                      <b>{t.nombre}</b>
                      <small>
                        {t.seccion}
                        {t.cantidad > 1 ? ` · ${t.cantidad}` : ''}
                        {t.adelantado ? ' · adelantado' : ''}
                      </small>
                      {t.indicaciones && <small className="ot-fila-indicacion">Indicación: {t.indicaciones}</small>}
                      {t.resultado && <small>Anotó: {t.resultado}</small>}
                    </span>
                    <span className="ot-fila-quien" onClick={(e) => p.asignar && t.estado !== 'done' && e.stopPropagation()}>
                      {p.asignar && t.estado !== 'done' ? (
                        <Select
                          size="small"
                          allowClear
                          placeholder="Sin asignar"
                          style={{ width: '100%' }}
                          value={t.asignadoId ?? undefined}
                          loading={p.cargandoPersonas}
                          options={opcionesDe(t)}
                          onChange={(v) => p.tarea.mutate({ id: t.id, accion: 'asignar', datos: { usuario: v ?? null } })}
                        />
                      ) : (
                        (t.asignado ?? <span className="tenue">Sin asignar</span>)
                      )}
                    </span>
                    <span className="ot-fila-estado">
                      <span className={`estado ${esta.tono}`}>{esta.texto}</span>
                      {detalle && <small className={esta.tono === 'naranjo' || esta.tono === 'dorado' ? 'problema-texto' : undefined}>{detalle}</small>}
                    </span>
                    <span className="ot-fila-horas">
                      {t.horas ? horas(t.horas) : '—'}
                      {t.horasReales !== null && <small title="En horario de taller, sin lo detenido">real {horas(Math.round(t.horasReales * 10) / 10)}</small>}
                    </span>
                    <span className="ot-fila-accion">{p.acciones ? <BotonesDeTarea t={t} yo={p.yo} gestiona={p.gestiona} trabaja={p.trabaja} accion={p.tarea} compacto /> : null}</span>
                  </div>
                )
              })}
          </Fragment>
        )
      })}
    </div>
  )
}

/** Lo que tiene ocupada una pieza, en una línea: «En proceso: rectificado de válvulas · Luis». */
function resumenDePieza(p: PiezaDeOt) {
  const a = p.actual
  if (p.situacion === 'done' || !a) return 'Lista'
  if (p.situacion === 'held' && a.detencion) return `Detenida: ${MOTIVOS_DETENCION[a.detencion.motivo].toLowerCase()}${a.detencion.nota ? ` (${a.detencion.nota})` : ''}`
  if (p.situacion === 'in_progress') return `En proceso: ${a.nombre}${a.asignado ? ` · ${a.asignado}` : ''}`
  if (p.situacion === 'available') return `Para empezar: ${a.nombre} · ${a.asignado ?? 'sin asignar'}`
  if (p.situacion === 'parts') return `Espera repuestos: ${enumerar(a.faltan)}`
  if (p.situacion === 'machine') return `Espera una máquina: ${a.nombre}`
  return textoEspera(a.espera)
}

/** Lo que pasó con la OT, lo último arriba. Se ven los últimos pasos; el resto, al pedirlo. */
function Historia({ historia }: { historia: DetalleOt['historia'] }) {
  const [toda, setToda] = useState(false)
  // Llega con lo último primero.
  const vista = toda ? historia : historia.slice(0, 8)
  return (
    <Bloque titulo="Historia" extra={historia.length > 8 && <button type="button" className="enlace" onClick={() => setToda(!toda)}>{toda ? 'Ver solo lo último' : `Ver los ${historia.length} pasos`}</button>}>
      <ul className="historia">
        {vista.map((h, i) => (
          <li key={i}>
            <span className="cuando">{fechaHora(h.en)}</span>
            <span>
              {h.que}
              {h.quien && <small className="ficha-nota">{h.quien}</small>}
            </span>
          </li>
        ))}
      </ul>
    </Bloque>
  )
}

function useAccionOt(otId: string, ruta: string, exito: string, cerrar: () => void) {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  return useMutation({
    mutationFn: (datos: unknown) => api('POST', `/servicio/ot/${otId}${ruta ? `/${ruta}` : ''}`, datos),
    onSuccess: async () => {
      message.success(exito)
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
}

/** Agregar una actividad de la lista: entra en la ruta de su pieza, contada con los datos del motor. */
function AgregarTrabajo({ ot, cerrar }: { ot: DetalleOt; cerrar: () => void }) {
  const [form] = Form.useForm<{ trabajoId: string; cantidad: number; pieza: Pieza }>()
  const catalogo = useQuery({ queryKey: ['taller', 'catalogo'], queryFn: () => api<Catalogo>('GET', '/servicio/catalogo') })
  const accion = useAccionOt(ot.id, 'tareas', 'Trabajo agregado.', cerrar)
  const trabajoId = Form.useWatch('trabajoId', form)
  const elegida = catalogo.data?.trabajos.find((t) => t.id === trabajoId)
  const pz = usePiezas()
  const grupos: Pieza[] = [...pz.sueltas, 'motor']
  const opciones = grupos
    .map((p) => ({ label: pz.nombre(p), options: (catalogo.data?.trabajos ?? []).filter((t) => t.pieza === p && t.activo).map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nombre}` })) }))
    .filter((g) => g.options.length)
  return (
    <Modal open title="Agregar un trabajo a la OT" okText="Agregar" cancelText="Cancelar" onCancel={cerrar} confirmLoading={accion.isPending} onOk={() => form.validateFields().then((v) => accion.mutate(v))} destroyOnHidden>
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="Actividad" name="trabajoId" rules={[{ required: true, message: 'Elige la actividad.' }]}>
          <Select
            showSearch
            optionFilterProp="label"
            loading={catalogo.isPending}
            options={opciones}
            onChange={(v) => {
              const t = catalogo.data?.trabajos.find((x) => x.id === v)
              if (t) form.setFieldsValue({ pieza: t.pieza, cantidad: cantidadSegun(t.criterio, motorDeDatos(ot)) })
            }}
          />
        </Form.Item>
        <div className="columnas">
          <Form.Item label="Pieza" name="pieza">
            <Select options={pz.opciones} />
          </Form.Item>
          <Form.Item label="Cantidad" name="cantidad" rules={[{ required: true, message: 'Escribe la cantidad.' }]} extra={elegida && comoSeCuenta(elegida.criterio) ? `Se cuenta ${comoSeCuenta(elegida.criterio)}, con los datos del motor.` : undefined}>
            <InputNumber min={1} max={1000} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  )
}

/**
 * Lo que dejan los repuestos de la OT: lo que se le cobra al cliente contra lo que costaron (el costo real donde se
 * anotó, el cotizado donde no). Solo lo que compra la rectificadora.
 */
function MargenRepuestos({ repuestos }: { repuestos: RepuestoDeOt[] }) {
  const propios = repuestos.filter((r) => r.compra === 'shop' && r.estado !== 'cancelled')
  const vendido = propios.reduce((s, r) => s + Math.round((r.precio ?? 0) * r.cantidad), 0)
  const costo = propios.reduce((s, r) => s + Math.round((r.costoReal ?? r.costo ?? 0) * r.cantidad), 0)
  const margen = margenDe(vendido, costo)
  if (!vendido) return null
  return (
    <span title="Lo cobrado al cliente por los repuestos que compra la rectificadora, contra lo que costaron">
      Cobrado {plata(vendido)} · costó {plata(costo)}
      {margen !== null && <b style={{ color: margen < 0.15 ? 'var(--naranjo)' : undefined }}> · margen {Math.round(margen * 100)} %</b>}
    </span>
  )
}

type DatosRepuesto = { descripcion: string; cantidad: number; compra: QuienCompra; proveedorId?: string | null; costo?: number | null; necesitaTareaId?: string | null; medida?: string; marca?: string; codigo?: string }

/** Un repuesto que aparece con la OT abierta (una pieza que se quebró al armar): lo espera el trabajo que se elija, o el armado. */
function AgregarRepuesto({ ot, veMontos, cerrar }: { ot: DetalleOt; veMontos: boolean; cerrar: () => void }) {
  const [form] = Form.useForm<DatosRepuesto>()
  const compra = Form.useWatch('compra', form) ?? 'shop'
  const accion = useAccionOt(ot.id, 'repuestos', 'Repuesto agregado: queda por pedir (o por llegar, si lo trae el cliente).', cerrar)
  const conCompras = usePersona().tiene('purchasing')
  const porHacer = ot.tareas.filter((t) => t.estado !== 'done')
  return (
    <Modal open title="Agregar un repuesto a la OT" okText="Agregar" cancelText="Cancelar" onCancel={cerrar} confirmLoading={accion.isPending} onOk={() => form.validateFields().then((v) => accion.mutate({ ...v, proveedorId: v.proveedorId ?? null, necesitaTareaId: v.necesitaTareaId ?? null }))} destroyOnHidden width={580}>
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ cantidad: 1, compra: 'shop' }}>
        <div className="columnas">
          <Form.Item label="Repuesto" name="descripcion" rules={[{ required: true, message: 'Escribe el repuesto.' }, { min: 2 }]}>
            <Input placeholder="Bomba de aceite" />
          </Form.Item>
          <Form.Item label="Cantidad" name="cantidad" rules={[{ required: true, message: 'Escribe la cantidad.' }]}>
            <InputNumber min={1} max={10_000} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div className="columnas-3">
          <Form.Item label="Medida" name="medida">
            <Input placeholder="STD, 0,25…" />
          </Form.Item>
          <Form.Item label="Marca" name="marca">
            <Input placeholder="Mahle" />
          </Form.Item>
          <Form.Item label="N° de parte" name="codigo">
            <Input placeholder="228-0001" />
          </Form.Item>
        </div>
        <Form.Item label="Quién lo compra" name="compra">
          <Radio.Group options={Object.entries(QUIEN_COMPRA).map(([value, label]) => ({ value, label: value === 'customer' ? `${label} (lo trae)` : label }))} />
        </Form.Item>
        {compra === 'shop' && (
          <div className="columnas">
            {conCompras && (
              <Form.Item label="Proveedor" name="proveedorId">
                <SelectorDeProveedor placeholder="Elegir después" />
              </Form.Item>
            )}
            {veMontos && (
              <Form.Item label="Costo por unidad (sin IVA)" name="costo">
                <InputNumber min={0} step={1000} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            )}
          </div>
        )}
        <Form.Item label="Lo espera" name="necesitaTareaId" extra="Ese trabajo no se puede empezar hasta que el repuesto llegue.">
          <Select allowClear placeholder="El armado" options={porHacer.map((t) => ({ value: t.id, label: t.nombre }))} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

type DatosEdicion = { numeroMotor?: string; equipo?: string; falla?: string; cilindros?: number | null; valvulasPorCilindro?: number | null; culatas?: number | null; entrega?: dayjs.Dayjs | null; prioridad: 'normal' | 'urgent' }

/** Lo que se sabe del motor y la entrega comprometida: se completa o corrige mientras la OT está abierta. */
function Editar({ ot, cerrar }: { ot: DetalleOt; cerrar: () => void }) {
  const [form] = Form.useForm<DatosEdicion>()
  const accion = useAccionOt(ot.id, '', 'OT actualizada.', cerrar)
  return (
    <Modal
      open
      title={`Editar ${folioOt(ot.numero)}`}
      okText="Guardar"
      cancelText="Cancelar"
      onCancel={cerrar}
      confirmLoading={accion.isPending}
      onOk={() => form.validateFields().then((v) => accion.mutate({ ...v, cilindros: v.cilindros ?? null, valvulasPorCilindro: v.valvulasPorCilindro ?? null, culatas: v.culatas ?? null, entrega: v.entrega ? v.entrega.format('YYYY-MM-DD') : null }))}
      destroyOnHidden
      width={620}
    >
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ numeroMotor: ot.numeroMotor ?? '', equipo: ot.equipo ?? '', falla: ot.falla ?? '', cilindros: ot.cilindros, valvulasPorCilindro: ot.valvulasPorCilindro, culatas: ot.culatas, entrega: ot.entrega ? dayjs(ot.entrega) : null, prioridad: ot.prioridad }}
      >
        <CamposDelMotor />
        <div className="columnas">
          <Form.Item label="Número de motor" name="numeroMotor">
            <Input />
          </Form.Item>
          <Form.Item label="Equipo y patente" name="equipo">
            <Input />
          </Form.Item>
        </div>
        <Form.Item label="Falla informada" name="falla">
          <Input.TextArea rows={2} />
        </Form.Item>
        <div className="columnas">
          <Form.Item label="Entrega comprometida" name="entrega">
            <DatePicker style={{ width: '100%' }} format="DD-MM-YYYY" />
          </Form.Item>
          <Form.Item label="Prioridad" name="prioridad">
            <Select options={Object.entries(PRIORIDADES_OT).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  )
}

function Entregar({ otId, contacto, cerrar }: { otId: string; contacto: string | null; cerrar: () => void }) {
  const [form] = Form.useForm<{ recibe: string }>()
  const accion = useAccionOt(otId, 'entregar', 'OT entregada.', cerrar)
  return (
    <Modal open title="Entregar al cliente" okText="Entregar" cancelText="Cancelar" onCancel={cerrar} confirmLoading={accion.isPending} onOk={() => form.validateFields().then((v) => accion.mutate(v))} destroyOnHidden>
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ recibe: contacto ?? '' }}>
        <Form.Item label="Quién recibe" name="recibe" rules={[{ required: true, message: 'Escribe quién recibe.' }, { min: 2 }]}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function Anular({ otId, cerrar }: { otId: string; cerrar: () => void }) {
  const [form] = Form.useForm<{ motivo: string }>()
  const accion = useAccionOt(otId, 'anular', 'OT anulada.', cerrar)
  return (
    <Modal open title="Anular la OT" okText="Anular" okButtonProps={{ danger: true }} cancelText="Cancelar" onCancel={cerrar} confirmLoading={accion.isPending} onOk={() => form.validateFields().then((v) => accion.mutate(v))} destroyOnHidden>
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} />}
      <p>Lo pendiente queda sin hacer. Úsalo cuando el cliente retira el motor sin reparar o la OT se abrió por error.</p>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="Motivo" name="motivo" rules={[{ required: true, message: 'Escribe el motivo.' }, { min: 5 }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
