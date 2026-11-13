// Las máquinas del taller: si están operando o detenidas (en falla o en mantención), a qué actividades sirven, cuántos
// trabajos las esperan y cuándo les toca mantención. Cualquiera que trabaje avisa que una falló; el jefe de taller la
// vuelve a poner en operación, anota las mantenciones y agrega o corrige máquinas.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Table } from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Cargando, Cifras, Estado, Hace, Problema } from '../../../pantallas/componentes'
import { cifra, fecha, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { usePersona } from '../../taller/pantallas/comun'
import type { Catalogo } from '../../taller/pantallas/tipos'
import { MOTIVOS_PARADA, type MotivoParada } from '../reglas'

export type Maquina = {
  id: string
  nombre: string
  seccionId: string | null
  seccion: string | null
  nota: string | null
  activa: boolean
  actividades: { id: string; codigo: string; nombre: string }[]
  trabajos: number
  parada: { motivo: MotivoParada; nota: string | null; desde: string; por: string | null } | null
  mantencion: { cadaDias: number | null; ultima: string | null; proxima: string | null; dias: number | null; vencida: boolean }
}

const dia = (d: string) => fecha(`${d}T12:00:00Z`)

/** Cuándo le toca la mantención, en palabras: «vencida hace 5 días», «en 12 días», «sin mantención fija». */
function Mantencion({ m }: { m: Maquina['mantencion'] }) {
  if (!m.cadaDias) return <span className="tenue">Sin mantención fija</span>
  if (m.dias === null) return <Estado tono="rojo">Nunca se ha hecho</Estado>
  const cuando = m.dias < 0 ? `Vencida hace ${plural(-m.dias, 'día')}` : m.dias === 0 ? 'Le toca hoy' : `En ${plural(m.dias, 'día')}`
  return (
    <div className="fila-nombre">
      {m.vencida || m.dias <= 7 ? <Estado tono={m.vencida ? 'rojo' : 'naranjo'}>{cuando}</Estado> : <span>{cuando}</span>}
      <small>
        {m.proxima ? dia(m.proxima) : ''} · cada {plural(m.cadaDias, 'día')}
      </small>
    </div>
  )
}

export function Maquinas() {
  const { gestiona, trabaja, suspendida } = usePersona()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [editar, setEditar] = useState<Maquina | 'nueva' | null>(null)
  const [deteniendo, setDeteniendo] = useState<Maquina | null>(null)
  const r = useQuery({ queryKey: ['taller', 'maquinas'], queryFn: () => api<Maquina[]>('GET', '/servicio/maquinas') })
  const accion = useMutation({
    mutationFn: ({ id, que }: { id: string; que: 'operar' | 'mantencion' }) => api('POST', `/servicio/maquinas/${id}/${que}`, que === 'mantencion' ? {} : undefined),
    onSuccess: async (_, { que }) => {
      message.success(que === 'operar' ? 'Máquina operando: sus trabajos ya pueden seguir.' : 'Mantención anotada: la próxima se cuenta desde hoy.')
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const activas = r.data.filter((m) => m.activa)
  const detenidas = activas.filter((m) => m.parada)
  const vencidas = activas.filter((m) => m.mantencion.vencida)
  const puede = gestiona && !suspendida
  return (
    <>
      <Encabezado titulo="Máquinas" sub="Si están operando, qué trabajos las necesitan y cuándo les toca mantención." acciones={puede ? <Button type="primary" onClick={() => setEditar('nueva')}>Nueva máquina</Button> : null} />
      <Cifras
        cifras={[
          { rotulo: 'Operando', valor: cifra(activas.length - detenidas.length), nota: `de ${plural(activas.length, 'máquina')}` },
          { rotulo: 'Detenidas', valor: cifra(detenidas.length), nota: detenidas.length ? `${plural(detenidas.reduce((s, m) => s + m.trabajos, 0), 'trabajo')} esperan` : 'ninguna', tono: detenidas.length ? 'naranjo' : undefined },
          { rotulo: 'Mantención vencida', valor: cifra(vencidas.length), tono: vencidas.length ? 'rojo' : undefined },
        ]}
      />
      <div className="bloque">
        <Table<Maquina>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={r.data}
          scroll={{ x: 960 }}
          locale={{ emptyText: 'Todavía no hay máquinas. Agrega las del taller y di qué actividades las necesitan: si una para, sus trabajos lo dicen solos.' }}
          rowClassName={(m) => (m.activa ? '' : 'fila-inactiva')}
          columns={[
            { title: 'Máquina', key: 'n', render: (_, m) => <div className="fila-nombre"><b>{m.nombre}</b><small>{[m.seccion, m.activa ? null : 'fuera de uso'].filter(Boolean).join(' · ') || '—'}</small></div> },
            {
              title: 'Estado',
              key: 'e',
              width: 230,
              render: (_, m) =>
                !m.activa ? (
                  <span className="tenue">Fuera de uso</span>
                ) : m.parada ? (
                  <div className="fila-nombre">
                    <span>
                      <Estado tono={m.parada.motivo === 'breakdown' ? 'rojo' : 'naranjo'}>{MOTIVOS_PARADA[m.parada.motivo]}</Estado>
                    </span>
                    <small>
                      {m.parada.nota ? `${m.parada.nota} · ` : ''}
                      <Hace iso={m.parada.desde} />
                      {m.parada.por ? ` · ${m.parada.por}` : ''}
                    </small>
                  </div>
                ) : (
                  <Estado tono="verde">Operando</Estado>
                ),
            },
            { title: 'La necesitan', key: 'a', render: (_, m) => (m.actividades.length ? <small>{m.actividades.map((a) => a.nombre).join(', ')}</small> : <span className="tenue">Ninguna actividad</span>) },
            { title: 'Trabajos por hacer', dataIndex: 'trabajos', align: 'right', width: 130, render: (v: number, m) => (v ? <b style={m.parada ? { color: 'var(--naranjo)' } : undefined}>{cifra(v)}</b> : <span className="tenue">0</span>) },
            { title: 'Mantención', key: 'm', width: 180, render: (_, m) => (m.activa ? <Mantencion m={m.mantencion} /> : null) },
            {
              title: '',
              key: 'x',
              width: 1,
              render: (_, m) =>
                m.activa && !suspendida ? (
                  <span className="botones-tarea">
                    {!m.parada && trabaja && <Button size="small" onClick={() => setDeteniendo(m)}>Detener</Button>}
                    {m.parada && puede && <Button size="small" type="primary" loading={accion.isPending && accion.variables?.id === m.id} onClick={() => accion.mutate({ id: m.id, que: 'operar' })}>Volver a operar</Button>}
                    {!m.parada && puede && m.mantencion.cadaDias ? <Button size="small" type="text" onClick={() => accion.mutate({ id: m.id, que: 'mantencion' })}>Mantención hecha</Button> : null}
                    {puede && <Button size="small" type="text" onClick={() => setEditar(m)}>Editar</Button>}
                  </span>
                ) : puede ? (
                  <Button size="small" type="text" onClick={() => setEditar(m)}>Editar</Button>
                ) : null,
            },
          ]}
        />
      </div>
      {editar && <FichaMaquina maquina={editar === 'nueva' ? null : editar} cerrar={() => setEditar(null)} />}
      {deteniendo && <Detener maquina={deteniendo} gestiona={gestiona} cerrar={() => setDeteniendo(null)} />}
    </>
  )
}

/** Detener una máquina: en falla (con lo que le pasa) o en mantención. Sus trabajos esperan hasta que vuelva a operar. */
function Detener({ maquina, gestiona, cerrar }: { maquina: Maquina; gestiona: boolean; cerrar: () => void }) {
  const [form] = Form.useForm<{ motivo: MotivoParada; nota?: string }>()
  const motivo = Form.useWatch('motivo', form)
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const detener = useMutation({
    mutationFn: (v: { motivo: MotivoParada; nota?: string }) => api('POST', `/servicio/maquinas/${maquina.id}/detener`, v),
    onSuccess: async () => {
      message.success(gestiona ? 'Máquina detenida: sus trabajos esperan.' : 'Avisado: el jefe de taller la vuelve a poner en operación.')
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  return (
    <Modal open title={`Detener ${maquina.nombre}`} okText="Detener" okButtonProps={{ danger: true }} cancelText="Cancelar" onCancel={cerrar} confirmLoading={detener.isPending} onOk={() => form.validateFields().then((v) => detener.mutate(v))} destroyOnHidden>
      {detener.isError && <Alert type="error" showIcon title={(detener.error as Error).message} style={{ marginBottom: 12 }} />}
      {maquina.trabajos > 0 && <p className="tenue" style={{ marginTop: 0 }}>{plural(maquina.trabajos, 'trabajo')} por hacer la necesitan: van a esperar hasta que vuelva a operar.</p>}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ motivo: 'breakdown' }}>
        <Form.Item name="motivo">
          <Radio.Group options={Object.entries(MOTIVOS_PARADA).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item label={motivo === 'breakdown' ? 'Qué le pasa' : 'Qué mantención (opcional)'} name="nota" rules={motivo === 'breakdown' ? [{ required: true, message: 'Escribe qué le pasa.' }, { min: 3 }] : []}>
          <Input.TextArea rows={2} placeholder={motivo === 'breakdown' ? 'No avanza el carro; ruido en el husillo' : 'Cambio de aceite y rodamientos'} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

type Datos = { nombre: string; seccionId?: string | null; actividades: string[]; cadaDias?: number | null; ultima?: dayjs.Dayjs | null; nota?: string; activa: boolean }

/** Agregar o corregir una máquina: dónde está, qué actividades la necesitan y cada cuánto le toca mantención. */
function FichaMaquina({ maquina, cerrar }: { maquina: Maquina | null; cerrar: () => void }) {
  const [form] = Form.useForm<Datos>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const catalogo = useQuery({ queryKey: ['taller', 'catalogo'], queryFn: () => api<Catalogo>('GET', '/servicio/catalogo') })
  const guardar = useMutation({
    mutationFn: (v: Datos) => api('POST', maquina ? `/servicio/maquinas/${maquina.id}` : '/servicio/maquinas', { ...v, seccionId: v.seccionId ?? null, cadaDias: v.cadaDias ?? null, ultima: v.ultima ? v.ultima.format('YYYY-MM-DD') : null }),
    onSuccess: async () => {
      message.success(maquina ? 'Máquina actualizada.' : 'Máquina agregada.')
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  const inicial: Datos = maquina
    ? { nombre: maquina.nombre, seccionId: maquina.seccionId, actividades: maquina.actividades.map((a) => a.id), cadaDias: maquina.mantencion.cadaDias, ultima: maquina.mantencion.ultima ? dayjs(maquina.mantencion.ultima) : null, nota: maquina.nota ?? '', activa: maquina.activa }
    : { nombre: '', actividades: [], activa: true }
  return (
    <Modal open title={maquina ? maquina.nombre : 'Nueva máquina'} okText={maquina ? 'Guardar' : 'Agregar'} cancelText="Cancelar" onCancel={cerrar} confirmLoading={guardar.isPending} onOk={() => form.validateFields().then((v) => guardar.mutate(v))} destroyOnHidden width={620}>
      {guardar.isError && <Alert type="error" showIcon title={(guardar.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={inicial}>
        <div className="columnas">
          <Form.Item label="Nombre" name="nombre" rules={[{ required: true, message: 'Escribe el nombre de la máquina.' }, { min: 2 }]}>
            <Input placeholder="Lineadora de bancada" />
          </Form.Item>
          <Form.Item label="Dónde está" name="seccionId">
            <Select allowClear placeholder="Sección" loading={catalogo.isPending} options={catalogo.data?.secciones.filter((s) => s.activa).map((s) => ({ value: s.id, label: s.nombre }))} />
          </Form.Item>
        </div>
        <Form.Item label="Actividades que la necesitan" name="actividades" extra="Si la máquina para, los trabajos de estas actividades esperan.">
          <Select mode="multiple" showSearch optionFilterProp="label" placeholder="Rectificado de cilindros…" loading={catalogo.isPending} options={catalogo.data?.trabajos.filter((t) => t.activo).map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nombre}` }))} />
        </Form.Item>
        <div className="columnas">
          <Form.Item label="Mantención cada (días)" name="cadaDias" extra="Vacío: sin mantención fija.">
            <InputNumber min={1} max={3650} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Última mantención" name="ultima">
            <DatePicker style={{ width: '100%' }} format="DD-MM-YYYY" />
          </Form.Item>
        </div>
        <Form.Item label="Nota" name="nota">
          <Input.TextArea rows={2} placeholder="Marca, modelo, quién le hace la mantención…" />
        </Form.Item>
        {maquina && (
          <Form.Item name="activa" valuePropName="checked" style={{ marginBottom: 0 }} extra="Fuera de uso no hace esperar a nadie y no se ofrece.">
            <Checkbox>En uso</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

