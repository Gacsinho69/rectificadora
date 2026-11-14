// La bodega de insumos: lo que el taller gasta y no es de una OT (aceite de prueba, pasta de esmeril, piedras de
// bruñir). Cuánto hay, su mínimo y lo que viene en camino. Cualquiera que trabaje saca lo que usa; el jefe de taller
// agrega insumos y ajusta el stock al conteo. Lo que queda en su mínimo aparece en Compras para pedirlo.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, AutoComplete, Button, Checkbox, Form, Input, InputNumber, Modal, Radio, Segmented, Select, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Cargando, Cifras, Estado, Hace, Problema } from '../../../pantallas/componentes'
import { cifra, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { folioOt, usePersona } from '../../taller/pantallas/comun'
import type { FilaOt, Insumo } from '../../taller/pantallas/tipos'
import { MOVIMIENTOS_INSUMO, referenciaDe, TIPOS_ARTICULO, type TipoArticulo, UNIDADES } from '../reglas'
import { SelectorDeProveedor } from './Proveedores'

export function Bodega() {
  const { gestiona, trabaja, veMontos, suspendida } = usePersona()
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState<TipoArticulo | 'todo'>('todo')
  const [dialogo, setDialogo] = useState<{ tipo: 'sacar' | 'ajustar' | 'editar'; insumo: Insumo } | 'nuevo' | null>(null)
  const r = useQuery({ queryKey: ['taller', 'insumos'], queryFn: () => api<Insumo[]>('GET', '/servicio/insumos') })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const activos = r.data.filter((x) => x.activo)
  const lista = r.data.filter((x) => (tipo === 'todo' || x.tipo === tipo) && (!q || `${x.nombre} ${x.marca ?? ''} ${x.codigo ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const puede = gestiona && !suspendida
  return (
    <>
      <Encabezado titulo="Bodega" sub="Insumos que gasta el taller y repuestos que se guardan: cuánto hay, su mínimo y lo que viene. Lo que queda en su mínimo aparece en Compras." acciones={puede ? <Button type="primary" onClick={() => setDialogo('nuevo')}>Nuevo artículo</Button> : null} />
      <Cifras
        cifras={[
          { rotulo: 'Insumos', valor: cifra(activos.length) },
          { rotulo: 'En su mínimo o menos', valor: cifra(activos.filter((x) => x.bajo).length), nota: 'hay que pedirlos', tono: activos.some((x) => x.bajo) ? 'rojo' : undefined },
          { rotulo: 'Vienen en camino', valor: cifra(activos.filter((x) => x.porLlegar > 0).length), nota: 'en órdenes de compra' },
        ]}
      />
      <div className="filtros">
        <Input.Search className="buscar" placeholder="Artículo, marca o código" allowClear onSearch={setQ} onChange={(e) => !e.target.value && setQ('')} />
        <Segmented value={tipo} onChange={(v) => setTipo(v as TipoArticulo | 'todo')} options={[{ value: 'todo', label: 'Todo' }, { value: 'supply', label: 'Insumos' }, { value: 'part', label: 'Repuestos' }]} />
      </div>
      <div className="bloque">
        <Table<Insumo>
          size="small"
          rowKey="id"
          pagination={lista.length > 50 ? { pageSize: 50 } : false}
          dataSource={lista}
          scroll={{ x: 900 }}
          locale={{ emptyText: q ? 'Ningún insumo calza con esa búsqueda.' : 'Todavía no hay insumos. Agrega los que gasta el taller, con su mínimo: cuando queden pocos, aparecen en Compras.' }}
          rowClassName={(x) => (x.activo ? '' : 'fila-inactiva')}
          expandable={{
            rowExpandable: (x) => x.movimientos.length > 0,
            expandedRowRender: (x) => (
              <ul className="lista-hecho">
                {x.movimientos.map((m) => (
                  <li key={m.id}>
                    <b>{MOVIMIENTOS_INSUMO[m.tipo]}</b> {m.cantidad > 0 ? '+' : ''}
                    {cifra(m.cantidad)} {x.unidad}
                    {m.ot ? ` · ${folioOt(m.ot)}` : ''}
                    {m.nota ? ` · ${m.nota}` : ''}
                    <small className="tenue">
                      {' '}
                      · {m.quien ?? '—'} · <Hace iso={m.en} />
                    </small>
                  </li>
                ))}
              </ul>
            ),
          }}
          columns={[
            { title: 'Artículo', key: 'n', render: (_, x) => <div className="fila-nombre"><b>{x.nombre}</b><small>{[TIPOS_ARTICULO[x.tipo], referenciaDe(x), x.activo ? null : 'fuera de uso'].filter(Boolean).join(' · ')}</small></div> },
            {
              title: 'Hay',
              key: 'h',
              align: 'right',
              width: 170,
              render: (_, x) => (
                <span className="evento-nombre" style={{ justifyContent: 'flex-end' }}>
                  {x.bajo && x.activo && <Estado tono="rojo">En su mínimo</Estado>}
                  <b>{cifra(x.stock)}</b> {x.unidad}
                </span>
              ),
            },
            { title: 'Mínimo', key: 'm', align: 'right', width: 100, render: (_, x) => (x.minimo ? `${cifra(x.minimo)} ${x.unidad}` : <span className="tenue">—</span>) },
            { title: 'Viene', key: 'v', align: 'right', width: 100, render: (_, x) => (x.porLlegar ? `${cifra(x.porLlegar)} ${x.unidad}` : <span className="tenue">—</span>) },
            ...(veMontos
              ? [
                  { title: 'Proveedor', key: 'p', width: 190, render: (_: unknown, x: Insumo) => x.proveedor ?? <span className="tenue">—</span> },
                  { title: 'Costo', key: 'c', align: 'right' as const, width: 110, render: (_: unknown, x: Insumo) => (x.costo ? `${plata(x.costo)} / ${x.unidad}` : <span className="tenue">—</span>) },
                ]
              : []),
            {
              title: '',
              key: 'x',
              width: 1,
              render: (_, x) =>
                suspendida ? null : (
                  <span className="botones-tarea">
                    {x.activo && trabaja && x.stock > 0 && <Button size="small" onClick={() => setDialogo({ tipo: 'sacar', insumo: x })}>Sacar</Button>}
                    {puede && x.activo && <Button size="small" type="text" onClick={() => setDialogo({ tipo: 'ajustar', insumo: x })}>Ajustar</Button>}
                    {puede && <Button size="small" type="text" onClick={() => setDialogo({ tipo: 'editar', insumo: x })}>Editar</Button>}
                  </span>
                ),
            },
          ]}
        />
      </div>
      {dialogo === 'nuevo' && <FichaInsumo insumo={null} veMontos={veMontos} cerrar={() => setDialogo(null)} />}
      {dialogo && dialogo !== 'nuevo' && dialogo.tipo === 'editar' && <FichaInsumo insumo={dialogo.insumo} veMontos={veMontos} cerrar={() => setDialogo(null)} />}
      {dialogo && dialogo !== 'nuevo' && dialogo.tipo === 'sacar' && <Sacar insumo={dialogo.insumo} cerrar={() => setDialogo(null)} />}
      {dialogo && dialogo !== 'nuevo' && dialogo.tipo === 'ajustar' && <Ajustar insumo={dialogo.insumo} cerrar={() => setDialogo(null)} />}
    </>
  )
}

/** Una mutación de la bodega que avisa y refresca el taller. */
function useBodega<T>(ruta: string, exito: string, cerrar: () => void) {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  return useMutation({
    mutationFn: (datos: T) => api('POST', ruta, datos),
    onSuccess: async () => {
      message.success(exito)
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
}

type DatosSacar = { cantidad: number; otId?: string | null; nota?: string }

/** Sacar de bodega lo que se usó, para una OT si se sabe. */
function Sacar({ insumo, cerrar }: { insumo: Insumo; cerrar: () => void }) {
  const [form] = Form.useForm<DatosSacar>()
  const sacar = useBodega<DatosSacar>(`/servicio/insumos/${insumo.id}/sacar`, 'Anotado lo que salió de bodega.', cerrar)
  const ots = useQuery({ queryKey: ['taller', 'ots-abiertas'], queryFn: () => api<{ filas: FilaOt[] }>('GET', '/servicio/ot?porPagina=200') })
  return (
    <Modal open title={`Sacar ${insumo.nombre}`} okText="Sacar" cancelText="Cancelar" onCancel={cerrar} confirmLoading={sacar.isPending} onOk={() => form.validateFields().then((v) => sacar.mutate({ ...v, otId: v.otId ?? null }))} destroyOnHidden>
      {sacar.isError && <Alert type="error" showIcon title={(sacar.error as Error).message} style={{ marginBottom: 12 }} />}
      <p className="tenue" style={{ marginTop: 0 }}>Hay {cifra(insumo.stock)} {insumo.unidad}.</p>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ cantidad: 1 }}>
        <div className="columnas">
          <Form.Item label={`Cantidad (${insumo.unidad})`} name="cantidad" rules={[{ required: true, message: 'Escribe la cantidad.' }]}>
            <InputNumber min={0.01} max={insumo.stock} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Para la OT (opcional)" name="otId">
            <Select allowClear showSearch optionFilterProp="label" loading={ots.isPending} options={ots.data?.filas.map((o) => ({ value: o.id, label: `${folioOt(o.numero)} · ${o.motor}` }))} />
          </Form.Item>
        </div>
        <Form.Item label="Nota (opcional)" name="nota">
          <Input placeholder="Prueba de presión del block" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

/** Ajustar el stock a lo que se contó, con su motivo. */
function Ajustar({ insumo, cerrar }: { insumo: Insumo; cerrar: () => void }) {
  const [form] = Form.useForm<{ stock: number; nota: string }>()
  const ajustar = useBodega<{ stock: number; nota: string }>(`/servicio/insumos/${insumo.id}/ajustar`, 'Stock ajustado.', cerrar)
  return (
    <Modal open title={`Ajustar ${insumo.nombre}`} okText="Ajustar" cancelText="Cancelar" onCancel={cerrar} confirmLoading={ajustar.isPending} onOk={() => form.validateFields().then((v) => ajustar.mutate(v))} destroyOnHidden>
      {ajustar.isError && <Alert type="error" showIcon title={(ajustar.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ stock: insumo.stock }}>
        <Form.Item label={`Lo que se contó (${insumo.unidad})`} name="stock" rules={[{ required: true, message: 'Escribe lo que se contó.' }]} extra={`El sistema dice ${cifra(insumo.stock)}. La diferencia queda como ajuste.`}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Motivo" name="nota" rules={[{ required: true, message: 'Escribe el motivo del ajuste.' }, { min: 3 }]}>
          <Input placeholder="Conteo de fin de mes" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

type DatosInsumo = { tipo: TipoArticulo; nombre: string; unidad: string; minimo: number; marca?: string; codigo?: string; proveedorId?: string | null; costo?: number | null; nota?: string; activo: boolean }

/** Agregar o corregir un insumo: cómo se cuenta, su mínimo y a quién se le compra. */
function FichaInsumo({ insumo, veMontos, cerrar }: { insumo: Insumo | null; veMontos: boolean; cerrar: () => void }) {
  const [form] = Form.useForm<DatosInsumo>()
  const guardar = useBodega<DatosInsumo>(insumo ? `/servicio/insumos/${insumo.id}` : '/servicio/insumos', insumo ? 'Insumo actualizado.' : 'Insumo agregado.', cerrar)
  const inicial: DatosInsumo = insumo
    ? { tipo: insumo.tipo, nombre: insumo.nombre, unidad: insumo.unidad, minimo: insumo.minimo, marca: insumo.marca ?? '', codigo: insumo.codigo ?? '', proveedorId: insumo.proveedorId, costo: insumo.costo, nota: insumo.nota ?? '', activo: insumo.activo }
    : { tipo: 'supply', nombre: '', unidad: 'unidad', minimo: 0, activo: true }
  return (
    <Modal open title={insumo ? insumo.nombre : 'Nuevo insumo'} okText={insumo ? 'Guardar' : 'Agregar'} cancelText="Cancelar" onCancel={cerrar} confirmLoading={guardar.isPending} onOk={() => form.validateFields().then((v) => guardar.mutate({ ...v, proveedorId: v.proveedorId ?? null, costo: v.costo ?? null }))} destroyOnHidden width={600}>
      {guardar.isError && <Alert type="error" showIcon title={(guardar.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={inicial}>
        <Form.Item name="tipo" extra="Un repuesto guardado (un kit que se usa seguido) se puede sacar para una OT en vez de comprarlo.">
          <Radio.Group options={[{ value: 'supply', label: 'Insumo: se gasta en el taller' }, { value: 'part', label: 'Repuesto: se instala en un motor' }]} />
        </Form.Item>
        <Form.Item label="Nombre" name="nombre" rules={[{ required: true, message: 'Escribe el nombre.' }, { min: 2 }]}>
          <Input placeholder="Aceite de prueba de presión" />
        </Form.Item>
        <div className="columnas-3">
          <Form.Item label="Se cuenta por" name="unidad" rules={[{ required: true, message: 'Escribe la unidad.' }]}>
            <AutoComplete options={UNIDADES.map((u) => ({ value: u }))} />
          </Form.Item>
          <Form.Item label="Mínimo" name="minimo" extra="Con esto o menos, hay que pedir.">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          {veMontos && (
            <Form.Item label="Costo por unidad" name="costo">
              <InputNumber min={0} step={500} precision={0} style={{ width: '100%' }} prefix="$" />
            </Form.Item>
          )}
        </div>
        <div className="columnas">
          <Form.Item label="Marca" name="marca">
            <Input />
          </Form.Item>
          <Form.Item label="Código" name="codigo">
            <Input />
          </Form.Item>
        </div>
        {veMontos && (
          <Form.Item label="Se le compra a" name="proveedorId">
            <SelectorDeProveedor placeholder="Elegir después" />
          </Form.Item>
        )}
        <Form.Item label="Nota" name="nota">
          <Input.TextArea rows={2} />
        </Form.Item>
        {insumo && (
          <Form.Item name="activo" valuePropName="checked" style={{ marginBottom: 0 }} extra="Fuera de uso no se ofrece ni se avisa cuando queda poco.">
            <Checkbox>En uso</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
