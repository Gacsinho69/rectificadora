// Las compras de la rectificadora: lo que hay que pedir, las órdenes de compra al proveedor con su chofer (por retirar y
// las últimas cerradas) y lo que traen los clientes. El jefe de taller pide y recibe; el chofer ve primero sus retiros y
// recibe lo que trajo. El técnico no ve costos. Recibir un repuesto libera el trabajo que lo esperaba.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Alert, App, Button, DatePicker, Form, Input, Modal, Select, Table } from 'antd'
import type dayjs from 'dayjs'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Hace, Problema } from '../../../pantallas/componentes'
import { cifra, fecha, plata, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { DondeRetirar, EstadoOcTag, EstadoRepuestoTag, folioOt, usePersona, usePortal } from '../../taller/pantallas/comun'
import type { Compras as DatosCompras, OrdenDeCompra, Persona, RepuestoEnCompras } from '../../taller/pantallas/tipos'
import { folioOc } from '../reglas'
import { SelectorDeProveedor } from './Proveedores'

export function Compras() {
  const portal = usePortal()
  const { persona, gestiona, veMontos, suspendida } = usePersona()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [elegidos, setElegidos] = useState<string[]>([])
  const [pidiendo, setPidiendo] = useState(false)
  const [anulando, setAnulando] = useState<OrdenDeCompra | null>(null)
  const r = useQuery({ queryKey: ['taller', 'compras'], queryFn: () => api<DatosCompras>('GET', '/servicio/compras') })
  const personas = useQuery({ queryKey: ['taller', 'personas'], queryFn: () => api<Persona[]>('GET', '/servicio/personas'), enabled: gestiona })
  const listo = (texto: string) => () => {
    message.success(texto)
    return consultas.invalidateQueries({ queryKey: ['taller'] })
  }
  const fallo = (e: unknown) => message.error((e as Error).message)
  const recibirOc = useMutation({
    mutationFn: ({ id, repuestos }: { id: string; repuestos?: string[] }) => api('POST', `/servicio/compras/ordenes/${id}/recibir`, { repuestos }),
    onSuccess: listo('Recibido en el taller: los trabajos que lo esperaban ya pueden seguir.'),
    onError: fallo,
  })
  const recibirSuelto = useMutation({ mutationFn: (id: string) => api('POST', `/servicio/repuestos/${id}/recibir`), onSuccess: listo('Repuesto recibido.'), onError: fallo })
  const cambiarChofer = useMutation({
    mutationFn: ({ id, choferId }: { id: string; choferId: string | null }) => api('POST', `/servicio/compras/ordenes/${id}/chofer`, { choferId }),
    onSuccess: listo('Chofer cambiado.'),
    onError: fallo,
  })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const { porPedir, clientes, ordenes } = r.data
  const abiertas = ordenes.filter((o) => o.estado === 'open')
  const misRetiros = abiertas.filter((o) => o.chofer?.id === persona?.id)
  const puede = gestiona && !suspendida
  const recibe = (o: OrdenDeCompra) => !suspendida && (gestiona || o.chofer?.id === persona?.id)
  const deOt = (x: RepuestoEnCompras) => (
    <small>
      <Link to="/c/$portal/ot/$id" params={{ portal, id: x.ot.id }}>
        {folioOt(x.ot.numero)}
      </Link>{' '}
      · {x.ot.motor}
      {x.necesita ? ` · lo espera: ${x.necesita}` : ''}
    </small>
  )
  return (
    <>
      <Encabezado titulo="Compras" sub="Repuestos por pedir, órdenes de compra con su chofer y lo que traen los clientes." />
      <Cifras
        cifras={[
          { rotulo: 'Por pedir', valor: cifra(porPedir.length), nota: 'los compra la rectificadora', tono: porPedir.length ? 'dorado' : undefined },
          { rotulo: 'Por retirar', valor: cifra(abiertas.length), nota: plural(abiertas.reduce((s, o) => s + o.repuestos.filter((x) => x.estado === 'ordered').length, 0), 'repuesto') },
          { rotulo: 'Los trae el cliente', valor: cifra(clientes.length), nota: 'todavía no llegan' },
          ...(misRetiros.length ? [{ rotulo: 'Mis retiros', valor: cifra(misRetiros.length), nota: 'a mi nombre', tono: 'azul' as const }] : []),
        ]}
      />
      {misRetiros.length > 0 && (
        <Bloque titulo="Mis retiros">
          <div className="retiros">
            {misRetiros.map((o) => (
              <article key={o.id} className="retiro">
                <div className="retiro-cabeza">
                  <b>
                    {folioOc(o.numero)} · {o.proveedor}
                  </b>
                  {o.llega && <span className="tenue">llega {fecha(`${o.llega}T12:00:00Z`)}</span>}
                </div>
                <DondeRetirar direccion={o.direccion} telefono={o.telefono} />
                <ul>
                  {o.repuestos
                    .filter((x) => x.estado === 'ordered')
                    .map((x) => (
                      <li key={x.id}>
                        {x.cantidad} × {x.descripcion} <span className="tenue">({folioOt(x.ot.numero)})</span>
                      </li>
                    ))}
                </ul>
                {o.nota && <small className="tenue">{o.nota}</small>}
                <Button type="primary" size="small" loading={recibirOc.isPending && recibirOc.variables?.id === o.id} onClick={() => recibirOc.mutate({ id: o.id })}>
                  Recibido en el taller
                </Button>
              </article>
            ))}
          </div>
        </Bloque>
      )}
      <Bloque
        titulo="Por pedir"
        extra={
          puede ? (
            <Button type="primary" disabled={!elegidos.length} onClick={() => setPidiendo(true)}>
              {elegidos.length ? `Pedir ${plural(elegidos.length, 'repuesto')}` : 'Elige qué pedir'}
            </Button>
          ) : null
        }
      >
        <Table<RepuestoEnCompras>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={porPedir}
          scroll={{ x: 760 }}
          locale={{ emptyText: 'Nada por pedir: lo que la rectificadora compra aparece aquí al aceptarse la cotización.' }}
          rowSelection={puede ? { selectedRowKeys: elegidos, onChange: (k) => setElegidos(k as string[]) } : undefined}
          columns={[
            { title: 'Repuesto', key: 'n', render: (_, x) => <div className="fila-nombre"><b>{x.descripcion}</b>{deOt(x)}</div> },
            { title: 'Cantidad', dataIndex: 'cantidad', align: 'right', width: 90 },
            ...(veMontos ? [{ title: 'Proveedor', dataIndex: 'proveedor', width: 190, render: (v: string | null) => v ?? <span className="tenue">Sin proveedor</span> }] : []),
            ...(veMontos ? [{ title: 'Costo', key: 'c', align: 'right' as const, width: 120, render: (_: unknown, x: RepuestoEnCompras) => (x.costo ? plata(Math.round(x.costo * x.cantidad)) : <span className="tenue">—</span>) }] : []),
            { title: 'Desde', dataIndex: 'creado', width: 110, render: (v: string) => <Hace iso={v} /> },
          ]}
        />
      </Bloque>
      <Bloque titulo="Órdenes de compra" extra={<span className="tenue">Por retirar y las últimas cerradas. Abre una para recibir por partes.</span>}>
        <Table<OrdenDeCompra>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={ordenes}
          scroll={{ x: 980 }}
          locale={{ emptyText: 'Todavía no hay órdenes de compra.' }}
          expandable={{
            rowExpandable: (o) => o.repuestos.length > 0,
            expandedRowRender: (o) => (
              <Table<RepuestoEnCompras>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={o.repuestos}
                columns={[
                  { title: 'Repuesto', key: 'n', render: (_, x) => <div className="fila-nombre"><span>{x.descripcion}</span>{deOt(x)}</div> },
                  { title: 'Cantidad', dataIndex: 'cantidad', align: 'right', width: 90 },
                  { title: 'Estado', key: 'e', width: 130, render: (_, x) => <EstadoRepuestoTag compra={x.compra} estado={x.estado} /> },
                  { title: 'Llegó', dataIndex: 'recibido', width: 120, render: (v: string | null) => (v ? fecha(v) : <span className="tenue">—</span>) },
                  {
                    title: '',
                    key: 'x',
                    width: 1,
                    render: (_, x) =>
                      x.estado === 'ordered' && recibe(o) ? (
                        <Button size="small" loading={recibirOc.isPending && recibirOc.variables?.repuestos?.[0] === x.id} onClick={() => recibirOc.mutate({ id: o.id, repuestos: [x.id] })}>
                          Recibido
                        </Button>
                      ) : null,
                  },
                ]}
              />
            ),
          }}
          columns={[
            { title: 'Orden', dataIndex: 'numero', width: 90, render: (v: number) => <b>{folioOc(v)}</b> },
            { title: 'Proveedor', dataIndex: 'proveedor' },
            {
              title: 'Chofer',
              key: 'ch',
              width: 200,
              render: (_, o) =>
                puede && o.estado === 'open' ? (
                  <Select
                    size="small"
                    allowClear
                    placeholder="Sin chofer"
                    style={{ width: 180 }}
                    value={o.chofer?.id}
                    loading={personas.isPending}
                    options={personas.data?.map((p) => ({ value: p.id, label: p.nombre }))}
                    onChange={(v) => cambiarChofer.mutate({ id: o.id, choferId: v ?? null })}
                  />
                ) : (
                  (o.chofer?.nombre ?? <span className="tenue">—</span>)
                ),
            },
            { title: 'Repuestos', key: 'r', width: 110, render: (_, o) => `${o.repuestos.filter((x) => x.estado === 'received').length} de ${o.repuestos.filter((x) => x.estado !== 'cancelled').length} llegaron` },
            { title: 'Estado', key: 'e', width: 120, render: (_, o) => <EstadoOcTag estado={o.estado} /> },
            { title: 'Emitida', dataIndex: 'creada', width: 110, render: (v: string) => fecha(v) },
            { title: 'Llega', dataIndex: 'llega', width: 110, render: (v: string | null) => (v ? fecha(`${v}T12:00:00Z`) : <span className="tenue">—</span>) },
            ...(veMontos ? [{ title: 'Costo', dataIndex: 'costo', align: 'right' as const, width: 110, render: (v: number | null) => (v ? plata(v) : <span className="tenue">—</span>) }] : []),
            {
              title: '',
              key: 'x',
              width: 1,
              render: (_, o) =>
                o.estado === 'open' ? (
                  <span className="botones-tarea">
                    {recibe(o) && (
                      <Button size="small" loading={recibirOc.isPending && recibirOc.variables?.id === o.id && !recibirOc.variables.repuestos} onClick={() => recibirOc.mutate({ id: o.id })}>
                        Recibir todo
                      </Button>
                    )}
                    {puede && (
                      <Button size="small" type="text" danger onClick={() => setAnulando(o)}>
                        Anular
                      </Button>
                    )}
                  </span>
                ) : o.estado === 'cancelled' && o.motivo ? (
                  <span className="tenue" title={o.motivo}>
                    Anulada
                  </span>
                ) : null,
            },
          ]}
        />
      </Bloque>
      <Bloque titulo="Los trae el cliente">
        <Table<RepuestoEnCompras>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={clientes}
          scroll={{ x: 700 }}
          locale={{ emptyText: 'Ningún cliente tiene repuestos por traer.' }}
          columns={[
            { title: 'Repuesto', key: 'n', render: (_, x) => <div className="fila-nombre"><b>{x.descripcion}</b>{deOt(x)}</div> },
            { title: 'Cantidad', dataIndex: 'cantidad', align: 'right', width: 90 },
            { title: 'Cliente', dataIndex: 'cliente', width: 220 },
            { title: 'Desde', dataIndex: 'creado', width: 110, render: (v: string) => <Hace iso={v} /> },
            {
              title: '',
              key: 'x',
              width: 1,
              render: (_, x) =>
                puede ? (
                  <Button size="small" loading={recibirSuelto.isPending && recibirSuelto.variables === x.id} onClick={() => recibirSuelto.mutate(x.id)} title="El cliente lo trajo">
                    Recibido
                  </Button>
                ) : null,
            },
          ]}
        />
      </Bloque>
      {pidiendo && (
        <NuevaOrden
          repuestos={porPedir.filter((x) => elegidos.includes(x.id))}
          personas={personas.data ?? []}
          cerrar={(listo) => {
            setPidiendo(false)
            if (listo) setElegidos([])
          }}
        />
      )}
      {anulando && <AnularOrden o={anulando} cerrar={() => setAnulando(null)} />}
    </>
  )
}

type DatosOrden = { proveedorId: string; choferId?: string; llega?: dayjs.Dayjs | null; nota?: string }

/** Emitir la orden de compra con lo elegido: a qué proveedor de la lista, quién va a buscarlo y cuándo llega. */
function NuevaOrden({ repuestos, personas, cerrar }: { repuestos: RepuestoEnCompras[]; personas: Persona[]; cerrar: (listo: boolean) => void }) {
  const [form] = Form.useForm<DatosOrden>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  // Si todo lo elegido se cotizó con el mismo proveedor, la orden parte con él.
  const proveedores = [...new Set(repuestos.map((x) => x.proveedorId ?? x.proveedor).filter((p): p is string => Boolean(p)))]
  const cotizado = proveedores.length === 1 ? (repuestos.find((x) => x.proveedorId)?.proveedorId ?? undefined) : undefined
  const emitir = useMutation({
    mutationFn: (v: DatosOrden) => api<{ numero: number }>('POST', '/servicio/compras/ordenes', { repuestos: repuestos.map((x) => x.id), proveedorId: v.proveedorId, choferId: v.choferId ?? null, llega: v.llega ? v.llega.format('YYYY-MM-DD') : null, nota: v.nota }),
    onSuccess: async (r) => {
      message.success(`${folioOc(r.numero)} emitida: queda por retirar.`)
      cerrar(true)
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  return (
    <Modal open title="Orden de compra" okText="Emitir la orden" cancelText="Cancelar" onCancel={() => cerrar(false)} confirmLoading={emitir.isPending} onOk={() => form.validateFields().then((v) => emitir.mutate(v))} destroyOnHidden width={600}>
      {emitir.isError && <Alert type="error" showIcon title={(emitir.error as Error).message} style={{ marginBottom: 12 }} />}
      {proveedores.length > 1 && <Alert type="warning" showIcon title={`Elegiste repuestos de ${proveedores.length} proveedores: la orden va a uno solo.`} style={{ marginBottom: 12 }} />}
      <ul className="lista-simple">
        {repuestos.map((x) => (
          <li key={x.id}>
            {x.cantidad} × {x.descripcion} <span className="tenue">({folioOt(x.ot.numero)})</span>
          </li>
        ))}
      </ul>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ proveedorId: cotizado }}>
        <Form.Item label="Proveedor" name="proveedorId" rules={[{ required: true, message: 'Elige el proveedor.' }]}>
          <SelectorDeProveedor allowClear={false} />
        </Form.Item>
        <div className="columnas">
          <Form.Item label="Chofer que lo va a buscar" name="choferId">
            <Select allowClear placeholder="Elegir después" showSearch optionFilterProp="label" options={personas.map((p) => ({ value: p.id, label: p.nombre }))} />
          </Form.Item>
          <Form.Item label="Llega" name="llega">
            <DatePicker style={{ width: '100%' }} format="DD-MM-YYYY" />
          </Form.Item>
        </div>
        <Form.Item label="Nota para el chofer" name="nota">
          <Input.TextArea rows={2} placeholder="Retirar en bodega, pagar con transferencia…" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/** Anular una orden de la que no ha llegado nada: lo que tenía vuelve a por pedir. */
function AnularOrden({ o, cerrar }: { o: OrdenDeCompra; cerrar: () => void }) {
  const [form] = Form.useForm<{ motivo: string }>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const anular = useMutation({
    mutationFn: (v: { motivo: string }) => api('POST', `/servicio/compras/ordenes/${o.id}/anular`, v),
    onSuccess: async () => {
      message.success(`${folioOc(o.numero)} anulada: sus repuestos vuelven a por pedir.`)
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  return (
    <Modal open title={`Anular ${folioOc(o.numero)}`} okText="Anular" okButtonProps={{ danger: true }} cancelText="Cancelar" onCancel={cerrar} confirmLoading={anular.isPending} onOk={() => form.validateFields().then((v) => anular.mutate(v))} destroyOnHidden>
      {anular.isError && <Alert type="error" showIcon title={(anular.error as Error).message} style={{ marginBottom: 12 }} />}
      <p>Solo se anula si no ha llegado nada. Sus repuestos vuelven a «Por pedir».</p>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="Motivo" name="motivo" rules={[{ required: true, message: 'Escribe el motivo.' }, { min: 3 }]}>
          <Input.TextArea rows={2} placeholder="El proveedor no tenía stock" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
