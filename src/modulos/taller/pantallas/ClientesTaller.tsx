// Los clientes del taller y su lista de precios.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Alert, App, Button, Form, Input, InputNumber, Modal, Switch, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Hace, Problema } from '../../../pantallas/componentes'
import { cifra, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { usePersona, usePortal } from './comun'
import type { Catalogo, Cliente } from './tipos'

export function ClientesTaller() {
  const { gestiona } = usePersona()
  const portal = usePortal()
  const ir = useNavigate()
  const [q, setQ] = useState('')
  const [nuevo, setNuevo] = useState(false)
  const r = useQuery({ queryKey: ['taller', 'clientes', q], queryFn: () => api<Cliente[]>('GET', `/servicio/clientes${q ? `?q=${encodeURIComponent(q)}` : ''}`) })
  return (
    <>
      <Encabezado titulo="Clientes" sub={r.data ? `${cifra(r.data.length)} clientes` : undefined} acciones={gestiona ? <Button type="primary" onClick={() => setNuevo(true)}>Nuevo cliente</Button> : null} />
      <div className="filtros">
        <Input.Search className="buscar" placeholder="Nombre, RUT o contacto" allowClear onSearch={setQ} />
      </div>
      {r.isError && <Problema error={r.error} />}
      <div className="bloque">
        <Table<Cliente>
          size="small"
          rowKey="id"
          loading={r.isFetching}
          dataSource={r.data}
          scroll={{ x: 760 }}
          pagination={(r.data?.length ?? 0) > 50 ? { pageSize: 50 } : false}
          rowClassName={() => 'fila-abre'}
          onRow={(c) => ({ onClick: () => ir({ to: '/c/$portal/ot', params: { portal }, search: { q: c.nombre, estado: 'todas' } }) })}
          columns={[
            { title: 'Cliente', key: 'n', render: (_, c) => <div className="fila-nombre"><b>{c.nombre}</b>{c.rut && <small>{c.rut}</small>}</div> },
            { title: 'Contacto', key: 'c', render: (_, c) => <div className="fila-nombre"><span>{c.contacto ?? '—'}</span>{c.telefono && <small>{c.telefono}</small>}</div> },
            { title: 'OT abiertas', dataIndex: 'abiertas', align: 'right', render: (v: number) => (v ? <b>{v}</b> : <span className="tenue">0</span>) },
            { title: 'OT en total', dataIndex: 'total', align: 'right' },
            { title: 'Última OT', dataIndex: 'ultima', render: (v: string | null) => <Hace iso={v} /> },
          ]}
        />
      </div>
      {nuevo && <NuevoCliente cerrar={() => setNuevo(false)} />}
    </>
  )
}

function NuevoCliente({ cerrar }: { cerrar: () => void }) {
  const [form] = Form.useForm<{ nombre: string; rut?: string; contacto?: string; telefono?: string; correo?: string }>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const crear = useMutation({
    mutationFn: (v: object) => api('POST', '/servicio/clientes', v),
    onSuccess: async () => {
      message.success('Cliente agregado.')
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller', 'clientes'] })
    },
  })
  return (
    <Modal open title="Nuevo cliente" okText="Agregar" cancelText="Cancelar" onCancel={cerrar} confirmLoading={crear.isPending} onOk={() => form.validateFields().then((v) => crear.mutate(v))} destroyOnHidden>
      {crear.isError && <Alert type="error" showIcon title={(crear.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="Nombre o razón social" name="nombre" rules={[{ required: true, message: 'Escribe el nombre.' }, { min: 2 }]}>
          <Input />
        </Form.Item>
        <div className="columnas">
          <Form.Item label="RUT" name="rut">
            <Input />
          </Form.Item>
          <Form.Item label="Contacto" name="contacto">
            <Input />
          </Form.Item>
          <Form.Item label="Teléfono" name="telefono">
            <Input />
          </Form.Item>
          <Form.Item label="Correo" name="correo" rules={[{ type: 'email', message: 'El correo no es válido.' }]}>
            <Input />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  )
}

/** La lista de trabajos con precio, por sección. El administrador ajusta precios y horas estándar. */
export function Precios() {
  const { esAdmin, veMontos } = usePersona()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const r = useQuery({ queryKey: ['taller', 'catalogo'], queryFn: () => api<Catalogo>('GET', '/servicio/catalogo') })
  const cambiar = useMutation({
    mutationFn: ({ id, ...datos }: { id: string; precio?: number | null; horas?: number; activo?: boolean }) => api('POST', `/servicio/catalogo/${id}`, datos),
    onSuccess: () => {
      message.success('Guardado.')
      return consultas.invalidateQueries({ queryKey: ['taller', 'catalogo'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  return (
    <>
      <Encabezado titulo="Lista de trabajos y precios" sub={esAdmin ? 'Precios en pesos, sin IVA. Los de terceros se cotizan a mano.' : 'Solo el administrador cambia precios.'} />
      {r.data.secciones.map((s) => (
        <Bloque key={s.id} titulo={s.nombre}>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={r.data.trabajos.filter((t) => t.seccionId === s.id)}
            scroll={{ x: 640 }}
            columns={[
              { title: 'Código', dataIndex: 'codigo', width: 80 },
              { title: 'Trabajo', dataIndex: 'nombre', render: (v: string, t) => (t.activo ? v : <span className="tenue">{v} (no se ofrece)</span>) },
              { title: 'Unidad', dataIndex: 'unidad', width: 100 },
              ...(veMontos
                ? [{ title: 'Precio', key: 'p', width: 160, align: 'right' as const, render: (_: unknown, t: Catalogo['trabajos'][number]) => (esAdmin ? <InputNumber size="small" min={0} step={1000} defaultValue={t.precio ?? undefined} placeholder="A mano" style={{ width: 130 }} onBlur={(e) => { const v = e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null; if (v !== t.precio) cambiar.mutate({ id: t.id, precio: v }) }} /> : t.precio ? plata(t.precio) : <span className="tenue">A mano</span>) }]
                : []),
              { title: 'Horas estándar', dataIndex: 'horas', width: 130, align: 'right', render: (v: number) => (v ? v.toLocaleString('es-CL', { maximumFractionDigits: 2 }) : '—') },
              ...(esAdmin ? [{ title: 'Se ofrece', key: 'a', width: 100, render: (_: unknown, t: Catalogo['trabajos'][number]) => <Switch size="small" checked={t.activo} onChange={(v) => cambiar.mutate({ id: t.id, activo: v })} /> }] : []),
            ]}
          />
        </Bloque>
      ))}
    </>
  )
}
