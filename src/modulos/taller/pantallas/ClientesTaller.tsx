// Los clientes del taller: con quién trabaja cada rectificadora y cuántas OT tiene cada uno.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Alert, App, Button, Form, Input, Modal, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Hace, Problema } from '../../../pantallas/componentes'
import { cifra } from '../../../pantallas/formato'
import { rutValido } from '../../../rut'
import { Encabezado } from '../../../pantallas/Marco'
import { usePersona, usePortal } from './comun'
import type { Cliente } from './tipos'

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
          <Form.Item label="RUT" name="rut" validateTrigger="onBlur" rules={[{ validator: (_, v?: string) => (!v?.trim() || rutValido(v) ? Promise.resolve() : Promise.reject(new Error('El RUT no es válido: revisa el dígito verificador.'))) }]}>
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
