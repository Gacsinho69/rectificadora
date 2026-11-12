// Una orden de trabajo: el motor, cómo va cada pieza (lo que se contesta en el mesón), sus trabajos en el orden de la
// ruta de su pieza con quién los tiene, su cotización y su historia.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Modal, Select, Table } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Problema } from '../../../pantallas/componentes'
import { fecha, fechaHora, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { cantidadSegun, MOTIVOS_DETENCION, nombreDeGrupo, PIEZAS, PIEZAS_SUELTAS, type Pieza, PRIORIDADES_OT } from '../reglas'
import { Avance, CamposDelMotor, comoSeCuenta, EstadoCotTag, EstadoOtTag, folioCot, folioOt, horas, motorDeDatos, PlazoTag, SituacionTag, textoEspera, textoMotor, usePersona, usePortal } from './comun'
import type { Catalogo, DetalleOt, Persona, PiezaDeOt, Tarea } from './tipos'
import { BotonesDeTarea, useAccionesDeTarea } from './Trabajo'

const ruta = getRouteApi('/c/$portal/ot/$id')

export function OrdenDeTrabajo() {
  const { id } = ruta.useParams()
  const portal = usePortal()
  const { persona, gestiona, veMontos, trabaja, suspendida } = usePersona()
  const ir = useNavigate()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [dialogo, setDialogo] = useState<'trabajo' | 'editar' | 'entregar' | 'anular' | null>(null)
  const r = useQuery({ queryKey: ['taller', 'ot', id], queryFn: () => api<DetalleOt>('GET', `/servicio/ot/${id}`) })
  const personas = useQuery({ queryKey: ['taller', 'personas'], queryFn: () => api<Persona[]>('GET', '/servicio/personas'), enabled: gestiona })
  const tarea = useAccionesDeTarea()
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
  /** Para asignar: primero quienes hacen esa actividad. */
  const opcionesDe = (t: Tarea) => {
    const lista = personas.data ?? []
    const hacen = lista.filter((p) => t.actividadId && p.actividades.includes(t.actividadId))
    const otras = lista.filter((p) => !hacen.includes(p))
    return [
      ...(hacen.length ? [{ label: 'Hacen esta actividad', options: hacen.map((p) => ({ value: p.id, label: p.nombre })) }] : []),
      { label: hacen.length ? 'Otras personas' : 'Personas', options: otras.map((p) => ({ value: p.id, label: p.nombre })) },
    ]
  }

  return (
    <>
      <Encabezado
        miga={<Link to="/c/$portal/ot" params={{ portal }}>Órdenes de trabajo</Link>}
        titulo={`${folioOt(ot.numero)} · ${ot.cliente.nombre}`}
        sub={
          <>
            <EstadoOtTag estado={ot.estado} />
            <PlazoTag plazo={ot.plazo} />
            {ot.prioridad === 'urgent' && <span className="estado rojo">Urgente</span>}
            <span>{ot.motor}</span>
            {ot.equipo && <span>{ot.equipo}</span>}
          </>
        }
        acciones={
          puede ? (
            <>
              {veMontos && !cotizacionVigente && <Button type="primary" onClick={() => ir({ to: '/c/$portal/cotizaciones/$id', params: { portal, id: 'nueva' }, search: { ot: ot.id } })}>Cotizar</Button>}
              {ot.estado === 'quality' && <Button type="primary" loading={calidad.isPending} onClick={() => calidad.mutate()}>Aprobar control de calidad</Button>}
              {ot.estado === 'ready' && <Button type="primary" onClick={() => setDialogo('entregar')}>Entregar</Button>}
              {ot.estado !== 'ready' && <Button onClick={() => setDialogo('trabajo')}>Agregar trabajo</Button>}
              <Button onClick={() => setDialogo('editar')}>Editar</Button>
              <Button danger onClick={() => setDialogo('anular')}>Anular</Button>
            </>
          ) : null
        }
      />
      {ot.estado === 'cancelled' && <Alert type="warning" showIcon className="problema" title={`Anulada ${fechaHora(ot.anulada)}`} description={ot.motivoAnulacion} />}
      {ot.estado === 'delivered' && <Alert type="success" showIcon className="problema" title={`Entregada ${fechaHora(ot.entregada)} a ${ot.entregadaA ?? '—'}`} />}
      <Cifras
        cifras={[
          { rotulo: 'Avance', valor: <Avance fraccion={ot.avance} ancho={110} /> },
          { rotulo: 'Trabajos', valor: `${ot.tareas.filter((t) => t.estado === 'done').length} de ${ot.tareas.length}`, nota: 'terminados' },
          { rotulo: 'Recibida', valor: fecha(ot.creada) },
          { rotulo: 'Entrega comprometida', valor: ot.entrega ? fecha(`${ot.entrega}T12:00:00Z`) : '—', tono: ot.plazo === 'atrasada' ? 'rojo' : ot.plazo === 'por_vencer' ? 'naranjo' : undefined },
          { rotulo: 'Llegó', valor: <span style={{ fontSize: 14 }}>{ot.piezas.map((p) => PIEZAS[p]).join(', ')}</span> },
        ]}
      />
      {!soloDiagnostico && abierta && <ComoVaCadaPieza piezas={ot.porPieza} />}
      <Bloque titulo="Trabajos por pieza">
        <Table<Tarea>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={ot.tareas}
          scroll={{ x: 1120 }}
          locale={{ emptyText: 'Sin trabajos todavía.' }}
          columns={[
            { title: 'Pieza', dataIndex: 'grupo', width: 150, render: (g: Tarea['grupo'], _, i) => (i === 0 || ot.tareas[i - 1].grupo !== g ? <b>{nombreDeGrupo(g)}</b> : null) },
            {
              title: 'Trabajo',
              key: 'n',
              render: (_, t) => (
                <div className="fila-nombre">
                  <span>{t.nombre}</span>
                  <small>
                    {t.seccion}
                    {t.adelantado ? ' · adelantado' : ''}
                  </small>
                </div>
              ),
            },
            {
              title: 'Situación',
              key: 's',
              width: 210,
              render: (_, t) => (
                <div className="fila-nombre">
                  <span>
                    <SituacionTag situacion={t.situacion} detencion={t.detencion} espera={t.espera} />
                  </span>
                  {t.situacion === 'waiting' && <small>{textoEspera(t.espera)}</small>}
                  {t.situacion === 'held' && t.detencion?.nota && <small>{t.detencion.nota}</small>}
                </div>
              ),
            },
            {
              title: 'Asignado a',
              key: 'a',
              width: 200,
              render: (_, t) =>
                gestiona && abierta && t.estado !== 'done' ? (
                  <Select
                    size="small"
                    allowClear
                    placeholder="Sin asignar"
                    style={{ width: 180 }}
                    value={t.asignadoId ?? undefined}
                    loading={personas.isPending}
                    options={opcionesDe(t)}
                    onChange={(v) => tarea.mutate({ id: t.id, accion: 'asignar', datos: { usuario: v ?? null } })}
                  />
                ) : (
                  (t.asignado ?? <span className="tenue">—</span>)
                ),
            },
            { title: 'Horas estándar', dataIndex: 'horas', align: 'right', width: 110, render: (v: number) => (v ? horas(v) : '—') },
            { title: 'Terminó', dataIndex: 'termino', width: 120, render: (v: string | null) => (v ? fechaHora(v) : <span className="tenue">—</span>) },
            { title: '', key: 'b', width: 1, render: (_, t) => (abierta && ot.estado !== 'ready' && ot.estado !== 'waiting_approval' ? <BotonesDeTarea t={t} yo={persona?.id} gestiona={gestiona} trabaja={trabaja && !suspendida} accion={tarea} /> : null) },
          ]}
        />
        {soloDiagnostico && ot.estado !== 'cancelled' && (
          <p className="tenue" style={{ margin: '10px 14px' }}>
            Cuando se apruebe la cotización, sus trabajos aparecen aquí, cada uno en la ruta de su pieza y con su especialista.
          </p>
        )}
      </Bloque>
      <div className="columnas">
        <Bloque titulo="El motor">
          <dl className="ficha">
            <dt>Cliente</dt>
            <dd>
              {ot.cliente.nombre}
              {ot.cliente.contacto && ` · ${ot.cliente.contacto}`}
              {ot.cliente.telefono && ` · ${ot.cliente.telefono}`}
            </dd>
            <dt>Motor</dt>
            <dd>{ot.motor}</dd>
            <dt>Cilindros, válvulas y culatas</dt>
            <dd>{textoMotor(ot) ?? <span className="tenue">Sin datos: se cotiza como 4 cilindros, 2 válvulas por cilindro y 1 culata</span>}</dd>
            <dt>Número de motor</dt>
            <dd>{ot.numeroMotor ?? '—'}</dd>
            <dt>Equipo</dt>
            <dd>{ot.equipo ?? '—'}</dd>
            <dt>Falla informada</dt>
            <dd>{ot.falla ?? '—'}</dd>
          </dl>
        </Bloque>
        {veMontos ? (
          <Bloque titulo="Cotizaciones">
            {ot.cotizaciones.length ? (
              <div style={{ margin: '-12px -14px' }}>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={ot.cotizaciones}
                  rowClassName={() => 'fila-abre'}
                  onRow={(q) => ({ onClick: () => ir({ to: '/c/$portal/cotizaciones/$id', params: { portal, id: q.id } }) })}
                  columns={[
                    { title: 'Cotización', dataIndex: 'numero', render: (v: number) => <b>{folioCot(v)}</b> },
                    { title: 'Estado', dataIndex: 'estado', render: (v) => <EstadoCotTag estado={v} /> },
                    { title: 'Total', dataIndex: 'total', align: 'right', render: (v: number) => plata(v) },
                    { title: 'Enviada', dataIndex: 'enviada', render: (v: string | null) => fecha(v) },
                  ]}
                />
              </div>
            ) : (
              <p className="tenue" style={{ margin: 0 }}>Sin cotización todavía. Se cotiza cuando el diagnóstico dice qué hay que hacer.</p>
            )}
          </Bloque>
        ) : null}
      </div>
      <Bloque titulo="Historia">
        <ul className="historia">
          {ot.historia.map((h, i) => (
            <li key={i}>
              <span className="cuando">{fechaHora(h.en)}</span>
              <span>{h.que}</span>
              {h.quien && <span className="tenue">{h.quien}</span>}
            </li>
          ))}
        </ul>
      </Bloque>
      {dialogo === 'trabajo' && <AgregarTrabajo ot={ot} cerrar={() => setDialogo(null)} />}
      {dialogo === 'editar' && <Editar ot={ot} cerrar={() => setDialogo(null)} />}
      {dialogo === 'entregar' && <Entregar otId={ot.id} contacto={ot.cliente.contacto} cerrar={() => setDialogo(null)} />}
      {dialogo === 'anular' && <Anular otId={ot.id} cerrar={() => setDialogo(null)} />}
    </>
  )
}

/** Una tarjeta por pieza: su avance y lo que la tiene ocupada («Culata: en proceso, rectificado de válvulas»). */
function ComoVaCadaPieza({ piezas }: { piezas: PiezaDeOt[] }) {
  const resumen = (p: PiezaDeOt) => {
    const a = p.actual
    if (p.situacion === 'done' || !a) return 'Lista'
    if (p.situacion === 'held' && a.detencion) return `Detenida: ${MOTIVOS_DETENCION[a.detencion.motivo].toLowerCase()}${a.detencion.nota ? ` (${a.detencion.nota})` : ''}`
    if (p.situacion === 'in_progress') return `En proceso: ${a.nombre}${a.asignado ? ` · ${a.asignado}` : ''}`
    if (p.situacion === 'available') return `Para hacer: ${a.nombre} · ${a.asignado ?? 'sin asignar'}`
    return textoEspera(a.espera)
  }
  return (
    <div className="piezas" aria-label="Cómo va cada pieza">
      {piezas.map((p) => (
        <div key={p.clave} className={`pieza ${p.situacion}`}>
          <div className="pieza-cabeza">
            <b>{p.nombre}</b>
            <span className="tenue">
              {p.hechas} de {p.total}
            </span>
          </div>
          <Avance fraccion={p.avance} ancho={90} />
          <small>{resumen(p)}</small>
        </div>
      ))}
    </div>
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
  const grupos: Pieza[] = [...PIEZAS_SUELTAS, 'motor']
  const opciones = grupos
    .map((p) => ({ label: PIEZAS[p], options: (catalogo.data?.trabajos ?? []).filter((t) => t.pieza === p && t.activo).map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nombre}` })) }))
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
            <Select options={Object.entries(PIEZAS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="Cantidad" name="cantidad" rules={[{ required: true, message: 'Escribe la cantidad.' }]} extra={elegida && comoSeCuenta(elegida.criterio) ? `Se cuenta ${comoSeCuenta(elegida.criterio)}, con los datos del motor.` : undefined}>
            <InputNumber min={1} max={1000} />
          </Form.Item>
        </div>
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
