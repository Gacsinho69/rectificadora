// Los proveedores de la rectificadora: a quién le compra los repuestos, con su contacto, dónde se retira y sus órdenes
// de compra. El jefe de taller y el administrador los agregan y corrigen; un proveedor no se borra, se desactiva y deja
// de ofrecerse. `SelectorDeProveedor` es como se elige uno al cotizar un repuesto, al agregarlo a una OT y al emitir la
// orden de compra: de la lista, o agregándolo ahí mismo.
import { PlusOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Estado, Hace, Problema } from '../../../pantallas/componentes'
import { cifra, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { rutValido } from '../../../rut'
import { usePersona } from '../../taller/pantallas/comun'
import type { Proveedor } from '../../taller/pantallas/tipos'
import { claveDeProveedor } from '../reglas'

/** La lista de proveedores. La comparten esta página y los selectores; el técnico no la pide. */
export function useProveedores() {
  const { veMontos, tiene } = usePersona()
  return useQuery({ queryKey: ['taller', 'proveedores'], queryFn: () => api<Proveedor[]>('GET', '/servicio/proveedores'), enabled: veMontos && tiene('purchasing') })
}

export function Proveedores() {
  const { gestiona, veMontos, suspendida } = usePersona()
  const puede = gestiona && !suspendida
  const [q, setQ] = useState('')
  const [ficha, setFicha] = useState<Proveedor | 'nuevo' | null>(null)
  const r = useProveedores()
  if (!veMontos) return <Problema error={new Error('Tu rol no ve la lista de proveedores.')} />
  const clave = claveDeProveedor(q)
  const lista = (r.data ?? []).filter((p) => !clave || [p.nombre, p.rut, p.contacto, p.nota].some((x) => x && claveDeProveedor(x).includes(clave)))
  const activos = r.data?.filter((p) => p.activo).length ?? 0
  return (
    <>
      <Encabezado
        titulo="Proveedores"
        sub={r.data ? `${plural(activos, 'proveedor', 'proveedores')} · a quién se le compran los repuestos` : undefined}
        acciones={puede ? <Button type="primary" onClick={() => setFicha('nuevo')}>Nuevo proveedor</Button> : null}
      />
      <div className="filtros">
        <Input.Search className="buscar" placeholder="Nombre, RUT, contacto o qué vende" allowClear onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
      </div>
      {r.isError && <Problema error={r.error} />}
      <div className="bloque">
        <Table<Proveedor>
          size="small"
          rowKey="id"
          loading={r.isPending && r.fetchStatus !== 'idle'}
          dataSource={lista}
          scroll={{ x: 900 }}
          pagination={lista.length > 50 ? { pageSize: 50 } : false}
          locale={{ emptyText: q ? 'Ningún proveedor calza con esa búsqueda.' : 'Todavía no hay proveedores. Agrega el primero: después se elige al cotizar un repuesto y al emitir la orden de compra.' }}
          rowClassName={() => (puede ? 'fila-abre' : '')}
          onRow={(p) => ({ onClick: () => puede && setFicha(p) })}
          columns={[
            {
              title: 'Proveedor',
              key: 'n',
              render: (_, p) => (
                <div className="fila-nombre">
                  <span>
                    <b>{p.nombre}</b> {!p.activo && <Estado tono="gris">Inactivo</Estado>}
                  </span>
                  {(p.rut || p.nota) && <small>{[p.rut, p.nota].filter(Boolean).join(' · ')}</small>}
                </div>
              ),
            },
            { title: 'Contacto', key: 'c', width: 210, render: (_, p) => <div className="fila-nombre"><span>{p.contacto ?? '—'}</span>{(p.telefono || p.correo) && <small>{[p.telefono, p.correo].filter(Boolean).join(' · ')}</small>}</div> },
            { title: 'Dónde se retira', dataIndex: 'direccion', width: 230, render: (v: string | null) => v ?? <span className="tenue">—</span> },
            { title: 'Por retirar', dataIndex: 'porRetirar', align: 'right', width: 100, render: (v: number) => (v ? <b>{cifra(v)}</b> : <span className="tenue">0</span>) },
            { title: 'Órdenes', dataIndex: 'ordenes', align: 'right', width: 90, render: (v: number) => cifra(v) },
            { title: 'Última orden', dataIndex: 'ultima', width: 120, render: (v: string | null) => (v ? <Hace iso={v} /> : <span className="tenue">—</span>) },
          ]}
        />
      </div>
      {ficha && <FichaProveedor proveedor={ficha === 'nuevo' ? null : ficha} cerrar={() => setFicha(null)} />}
    </>
  )
}

type Datos = { nombre: string; rut?: string; contacto?: string; telefono?: string; correo?: string; direccion?: string; nota?: string; activo: boolean }

/** Agregar un proveedor o corregir sus datos. `alGuardar` recibe el recién agregado, para dejarlo elegido donde se pidió. */
export function FichaProveedor({ proveedor, nombre, cerrar, alGuardar }: { proveedor: Proveedor | null; nombre?: string; cerrar: () => void; alGuardar?: (p: { id: string; nombre: string }) => void }) {
  const [form] = Form.useForm<Datos>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const guardar = useMutation({
    mutationFn: async (v: Datos) => {
      if (proveedor) {
        await api('POST', `/servicio/proveedores/${proveedor.id}`, v)
        return { id: proveedor.id, nombre: v.nombre }
      }
      return api<{ id: string; nombre: string }>('POST', '/servicio/proveedores', v)
    },
    onSuccess: async (p) => {
      message.success(proveedor ? 'Proveedor actualizado.' : 'Proveedor agregado a la lista.')
      // La lista se refresca antes de avisar: quien pidió el proveedor nuevo ya lo encuentra en ella.
      await consultas.invalidateQueries({ queryKey: ['taller'] })
      alGuardar?.(p)
      cerrar()
    },
  })
  const inicial: Datos = proveedor
    ? { nombre: proveedor.nombre, rut: proveedor.rut ?? '', contacto: proveedor.contacto ?? '', telefono: proveedor.telefono ?? '', correo: proveedor.correo ?? '', direccion: proveedor.direccion ?? '', nota: proveedor.nota ?? '', activo: proveedor.activo }
    : { nombre: nombre ?? '', activo: true }
  return (
    <Modal open title={proveedor ? proveedor.nombre : 'Nuevo proveedor'} okText={proveedor ? 'Guardar' : 'Agregar'} cancelText="Cancelar" onCancel={cerrar} confirmLoading={guardar.isPending} onOk={() => form.validateFields().then((v) => guardar.mutate(v))} destroyOnHidden width={600}>
      {guardar.isError && <Alert type="error" showIcon title={(guardar.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={inicial}>
        <div className="columnas">
          <Form.Item label="Nombre o razón social" name="nombre" rules={[{ required: true, message: 'Escribe el nombre.' }, { min: 2, message: 'Escribe el nombre.' }]}>
            <Input placeholder="Repuestos Diesel Sur" />
          </Form.Item>
          <Form.Item label="RUT" name="rut" validateTrigger="onBlur" rules={[{ validator: (_, v?: string) => (!v?.trim() || rutValido(v) ? Promise.resolve() : Promise.reject(new Error('El RUT no es válido: revisa el dígito verificador.'))) }]}>
            <Input placeholder="76.123.456-7" />
          </Form.Item>
          <Form.Item label="Contacto" name="contacto">
            <Input placeholder="Con quién se habla" />
          </Form.Item>
          <Form.Item label="Teléfono" name="telefono">
            <Input placeholder="+56 9 …" />
          </Form.Item>
        </div>
        <Form.Item label="Correo" name="correo" rules={[{ type: 'email', message: 'El correo no es válido.' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Dónde se retira" name="direccion" extra="El chofer la ve en su retiro.">
          <Input placeholder="Av. Colón 3456, Talcahuano" />
        </Form.Item>
        <Form.Item label="Nota" name="nota">
          <Input.TextArea rows={2} placeholder="Qué vende, cómo se le paga, horario de bodega…" />
        </Form.Item>
        {proveedor && (
          <Form.Item name="activo" valuePropName="checked" extra={`Desactivado no se ofrece al cotizar ni al pedir; ${proveedor.porRetirar ? `lo que tiene por retirar (${plural(proveedor.porRetirar, 'orden', 'órdenes')}) sigue su curso` : 'sus órdenes quedan como están'}.`} style={{ marginBottom: 0 }}>
            <Checkbox>Activo: se le sigue comprando</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}

/**
 * Elegir un proveedor de la lista, o agregarlo ahí mismo si no está. Vale suelto o dentro de un formulario (`value` y
 * `onChange`). El que ya estaba elegido se sigue viendo aunque esté inactivo.
 */
export function SelectorDeProveedor({ value, onChange, size, style, placeholder = 'Elegir proveedor', allowClear = true }: { value?: string | null; onChange?: (id: string | null, proveedor: { id: string; nombre: string } | null) => void; size?: 'small' | 'middle'; style?: React.CSSProperties; placeholder?: string; allowClear?: boolean }) {
  const { gestiona, suspendida } = usePersona()
  const r = useProveedores()
  const [agregando, setAgregando] = useState(false)
  const [escrito, setEscrito] = useState('')
  const [recien, setRecien] = useState<{ id: string; nombre: string } | null>(null)
  const lista = r.data ?? []
  const opciones = lista.filter((p) => p.activo || p.id === value).map((p) => ({ value: p.id, label: p.activo ? p.nombre : `${p.nombre} (inactivo)` }))
  // El recién agregado se ofrece de inmediato, aunque la lista todavía no llegue de vuelta.
  if (recien && !opciones.some((o) => o.value === recien.id)) opciones.push({ value: recien.id, label: recien.nombre })
  return (
    <>
      <Select
        size={size}
        style={style}
        value={value ?? undefined}
        placeholder={placeholder}
        allowClear={allowClear}
        showSearch
        loading={r.isPending && r.fetchStatus !== 'idle'}
        options={opciones}
        filterOption={(texto, o) => claveDeProveedor(String(o?.label ?? '')).includes(claveDeProveedor(texto))}
        onSearch={setEscrito}
        onChange={(v?: string) => onChange?.(v ?? null, v ? { id: v, nombre: lista.find((p) => p.id === v)?.nombre ?? recien?.nombre ?? '' } : null)}
        notFoundContent={r.isError ? (r.error as Error).message : lista.length ? 'No está en la lista.' : 'Todavía no hay proveedores.'}
        popupRender={(menu) => (
          <>
            {menu}
            {gestiona && !suspendida && (
              <Button type="link" size="small" icon={<PlusOutlined />} style={{ margin: '4px 4px 2px' }} onMouseDown={(e) => e.preventDefault()} onClick={() => setAgregando(true)}>
                {escrito.trim() ? `Agregar «${escrito.trim()}» a la lista` : 'Agregar un proveedor'}
              </Button>
            )}
          </>
        )}
      />
      {agregando && (
        <FichaProveedor
          proveedor={null}
          nombre={escrito.trim()}
          cerrar={() => setAgregando(false)}
          alGuardar={(p) => {
            setRecien(p)
            setEscrito('')
            onChange?.(p.id, p)
          }}
        />
      )}
    </>
  )
}
