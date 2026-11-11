// Una orden de trabajo: el motor, sus trabajos por sección con quién los tiene, su avance, su cotización y su historia.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Problema } from '../../../pantallas/componentes'
import { fecha, fechaHora, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { PIEZAS } from '../reglas'
import { Avance, EstadoCotTag, EstadoOtTag, EstadoTareaTag, folioCot, folioOt, PlazoTag, usePersona, usePortal } from './comun'
import type { Catalogo, DetalleOt, Persona, Tarea } from './tipos'

const ruta = getRouteApi('/c/$portal/ot/$id')

/** Las acciones sobre una tarea: iniciar y terminar (quien la tiene o el jefe), asignar (el jefe). */
export function useAccionesDeTarea() {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  return useMutation({
    mutationFn: ({ id, accion, datos }: { id: string; accion: 'iniciar' | 'terminar' | 'asignar'; datos?: unknown }) => api('POST', `/servicio/tareas/${id}/${accion}`, datos ?? {}),
    onSuccess: () => consultas.invalidateQueries({ queryKey: ['taller'] }),
    onError: (e) => message.error((e as Error).message),
  })
}

export function BotonesDeTarea({ t, yo, gestiona, trabaja, accion }: { t: { id: string; estado: Tarea['estado']; asignadoId: string | null }; yo?: string; gestiona: boolean; trabaja: boolean; accion: ReturnType<typeof useAccionesDeTarea> }) {
  if (!trabaja || t.estado === 'done') return null
  const suya = !t.asignadoId || t.asignadoId === yo || gestiona
  if (!suya) return null
  const cargando = accion.isPending && accion.variables?.id === t.id
  return t.estado === 'pending' ? (
    <Button size="small" loading={cargando} onClick={(e) => { e.stopPropagation(); accion.mutate({ id: t.id, accion: 'iniciar' }) }}>Iniciar</Button>
  ) : (
    <Button size="small" type="primary" loading={cargando} onClick={(e) => { e.stopPropagation(); accion.mutate({ id: t.id, accion: 'terminar' }) }}>Terminar</Button>
  )
}

export function OrdenDeTrabajo() {
  const { id } = ruta.useParams()
  const portal = usePortal()
  const { persona, gestiona, veMontos, trabaja, suspendida } = usePersona()
  const ir = useNavigate()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [dialogo, setDialogo] = useState<'trabajo' | 'entregar' | 'anular' | null>(null)
  const r = useQuery({ queryKey: ['taller', 'ot', id], queryFn: () => api<DetalleOt>('GET', `/servicio/ot/${id}`) })
  const personas = useQuery({ queryKey: ['taller', 'personas'], queryFn: () => api<Persona[]>('GET', '/servicio/personas'), enabled: gestiona })
  const tarea = useAccionesDeTarea()
  const calidad = useMutation({
    mutationFn: () => api('POST', `/servicio/ot/${id}/calidad`),
    onSuccess: () => { message.success('Control de calidad aprobado: lista para entregar.'); return consultas.invalidateQueries({ queryKey: ['taller'] }) },
    onError: (e) => message.error((e as Error).message),
  })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const ot = r.data
  const abierta = ot.estado !== 'delivered' && ot.estado !== 'cancelled'
  const puede = gestiona && !suspendida && abierta
  const cotizacionVigente = ot.cotizaciones.find((q) => q.estado === 'accepted' || q.estado === 'sent' || q.estado === 'draft')
  const porSeccion = [...new Set(ot.tareas.map((t) => t.seccion))]

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
          { rotulo: 'Piezas', valor: <span style={{ fontSize: 14 }}>{ot.piezas.map((p) => PIEZAS[p]).join(', ')}</span> },
        ]}
      />
      <Bloque titulo="Trabajos por sección">
        <Table<Tarea>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={ot.tareas}
          scroll={{ x: 820 }}
          locale={{ emptyText: 'Sin trabajos todavía.' }}
          columns={[
            { title: 'Sección', dataIndex: 'seccion', width: 170, render: (v: string, t, i) => (i === 0 || ot.tareas[i - 1].seccion !== v ? <b>{v}</b> : null) },
            { title: 'Trabajo', dataIndex: 'nombre' },
            { title: 'Estado', dataIndex: 'estado', render: (v) => <EstadoTareaTag estado={v} /> },
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
                    options={personas.data?.map((p) => ({ value: p.id, label: p.nombre }))}
                    onChange={(v) => tarea.mutate({ id: t.id, accion: 'asignar', datos: { usuario: v ?? null } })}
                  />
                ) : (
                  t.asignado ?? <span className="tenue">—</span>
                ),
            },
            { title: 'Horas estándar', dataIndex: 'horas', align: 'right', render: (v: number) => (v ? v.toLocaleString('es-CL', { maximumFractionDigits: 1 }) : '—') },
            { title: 'Terminó', dataIndex: 'termino', render: (v: string | null) => (v ? fechaHora(v) : <span className="tenue">—</span>) },
            { title: '', key: 'b', width: 1, render: (_, t) => (abierta && ot.estado !== 'ready' ? <BotonesDeTarea t={t} yo={persona?.id} gestiona={gestiona} trabaja={trabaja && !suspendida} accion={tarea} /> : null) },
          ]}
        />
        {porSeccion.length === 1 && ot.tareas.every((t) => t.diagnostico) && ot.estado !== 'cancelled' && (
          <p className="tenue" style={{ margin: '10px 14px' }}>
            Cuando se apruebe la cotización, sus trabajos aparecen aquí, cada uno en su sección.
          </p>
        )}
      </Bloque>
      <div className="columnas">
        <Bloque titulo="El motor">
          <dl className="ficha">
            <dt>Cliente</dt>
            <dd>{ot.cliente.nombre}{ot.cliente.contacto && ` · ${ot.cliente.contacto}`}{ot.cliente.telefono && ` · ${ot.cliente.telefono}`}</dd>
            <dt>Motor</dt>
            <dd>{ot.motor}</dd>
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
      {dialogo === 'trabajo' && <AgregarTrabajo otId={ot.id} cerrar={() => setDialogo(null)} />}
      {dialogo === 'entregar' && <Entregar otId={ot.id} contacto={ot.cliente.contacto} cerrar={() => setDialogo(null)} />}
      {dialogo === 'anular' && <Anular otId={ot.id} cerrar={() => setDialogo(null)} />}
    </>
  )
}

function useAccionOt(otId: string, ruta: string, exito: string, cerrar: () => void) {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  return useMutation({
    mutationFn: (datos: unknown) => api('POST', `/servicio/ot/${otId}/${ruta}`, datos),
    onSuccess: async () => {
      message.success(exito)
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
}

function AgregarTrabajo({ otId, cerrar }: { otId: string; cerrar: () => void }) {
  const [form] = Form.useForm<{ trabajoId: string; cantidad: number }>()
  const catalogo = useQuery({ queryKey: ['taller', 'catalogo'], queryFn: () => api<Catalogo>('GET', '/servicio/catalogo') })
  const accion = useAccionOt(otId, 'tareas', 'Trabajo agregado.', cerrar)
  const opciones = catalogo.data?.secciones.map((s) => ({ label: s.nombre, options: catalogo.data.trabajos.filter((t) => t.seccionId === s.id && t.activo).map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nombre}` })) }))
  return (
    <Modal open title="Agregar un trabajo a la OT" okText="Agregar" cancelText="Cancelar" onCancel={cerrar} confirmLoading={accion.isPending} onOk={() => form.validateFields().then((v) => accion.mutate(v))} destroyOnHidden>
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ cantidad: 1 }}>
        <Form.Item label="Trabajo" name="trabajoId" rules={[{ required: true, message: 'Elige el trabajo.' }]}>
          <Select showSearch optionFilterProp="label" loading={catalogo.isPending} options={opciones} />
        </Form.Item>
        <Form.Item label="Cantidad (cilindros, válvulas, bielas…)" name="cantidad">
          <InputNumber min={1} max={1000} />
        </Form.Item>
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
