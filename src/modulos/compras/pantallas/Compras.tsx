// Las compras de la rectificadora: lo que hay que pedir, las órdenes de compra al proveedor con su chofer (por retirar y
// las últimas cerradas) y lo que traen los clientes. El jefe de taller pide y recibe; el chofer ve primero sus retiros y
// recibe lo que trajo. El técnico no ve costos. Recibir un repuesto libera el trabajo que lo esperaba.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Alert, App, Button, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Table } from 'antd'
import type dayjs from 'dayjs'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Estado, Hace, Problema } from '../../../pantallas/componentes'
import { cifra, fecha, plata, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { DondeRetirar, EstadoOcTag, EstadoRepuestoTag, folioOt, PlazoTag, usePersona, usePortal } from '../../taller/pantallas/comun'
import type { Compras as DatosCompras, Insumo, InsumoBajo, LineaInsumoOc, OrdenDeCompra, Persona, RepuestoEnCompras } from '../../taller/pantallas/tipos'
import { candidatosDeBodega, folioOc, porProveedor, referenciaDe } from '../reglas'
import { SelectorDeProveedor } from './Proveedores'

export function Compras() {
  const portal = usePortal()
  const { persona, gestiona, veMontos, suspendida, tiene } = usePersona()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [elegidos, setElegidos] = useState<string[]>([])
  const [insumosElegidos, setInsumosElegidos] = useState<string[]>([])
  const [pidiendo, setPidiendo] = useState(false)
  const [anulando, setAnulando] = useState<OrdenDeCompra | null>(null)
  const [deBodega, setDeBodega] = useState<RepuestoEnCompras | null>(null)
  const r = useQuery({ queryKey: ['taller', 'compras'], queryFn: () => api<DatosCompras>('GET', '/servicio/compras') })
  const personas = useQuery({ queryKey: ['taller', 'personas'], queryFn: () => api<Persona[]>('GET', '/servicio/personas'), enabled: gestiona })
  const listo = (texto: string) => () => {
    message.success(texto)
    return consultas.invalidateQueries({ queryKey: ['taller'] })
  }
  const fallo = (e: unknown) => message.error((e as Error).message)
  const recibirOc = useMutation({
    mutationFn: ({ id, repuestos, insumos }: { id: string; repuestos?: string[]; insumos?: string[] }) => api('POST', `/servicio/compras/ordenes/${id}/recibir`, { repuestos, insumos }),
    onSuccess: listo('Recibido en el taller: los trabajos que lo esperaban ya pueden seguir.'),
    onError: fallo,
  })
  const anotar = useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: object }) => api('POST', `/servicio/compras/ordenes/${id}/costos`, datos),
    onSuccess: listo('Anotado.'),
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
  const { porPedir, clientes, ordenes, insumosBajos } = r.data
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
                        {x.cantidad} × {x.descripcion}
                        {referenciaDe(x) ? ` · ${referenciaDe(x)}` : ''} <span className="tenue">({folioOt(x.ot.numero)})</span>
                      </li>
                    ))}
                  {o.insumos
                    .filter((x) => x.estado === 'ordered')
                    .map((x) => (
                      <li key={x.id}>
                        {cifra(x.cantidad)} {x.unidad} × {x.nombre} <span className="tenue">(bodega)</span>
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
            <Button type="primary" disabled={!elegidos.length && !insumosElegidos.length} onClick={() => setPidiendo(true)}>
              {elegidos.length || insumosElegidos.length ? `Pedir ${plural(elegidos.length + insumosElegidos.length, 'elegido')}` : 'Elige qué pedir'}
            </Button>
          ) : null
        }
      >
        {!porPedir.length && <p className="tenue">Nada por pedir: lo que la rectificadora compra aparece aquí al aceptarse la cotización, o cuando un técnico pide un repuesto.</p>}
        {/* Por proveedor (lo que se cotizó con cada uno), y dentro, lo que la OT necesita antes. */}
        {porProveedor(porPedir).map((g) => (
          <div key={g.clave} className="grupo-compra">
            <div className="grupo-compra-cabeza">
              <span>
                <b>{veMontos ? (g.proveedor ?? 'Sin proveedor') : 'Repuestos'}</b> <span className="tenue">· {plural(g.repuestos.length, 'repuesto')}{veMontos && g.costo ? ` · ${plata(g.costo)}` : ''}</span>
              </span>
              {puede && (
                <Button size="small" onClick={() => { setElegidos(g.repuestos.map((x) => x.id)); setPidiendo(true) }}>
                  {veMontos && g.proveedor ? `Pedir todo a ${g.proveedor}` : 'Pedir todo esto'}
                </Button>
              )}
            </div>
            <Table<RepuestoEnCompras>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={g.repuestos}
              scroll={{ x: 760 }}
              rowSelection={puede ? { selectedRowKeys: elegidos, onChange: (k) => setElegidos([...elegidos.filter((e) => !g.repuestos.some((x) => x.id === e)), ...(k as string[])]) } : undefined}
              columns={[
                { title: 'Repuesto', key: 'n', render: (_, x) => <div className="fila-nombre"><b>{x.descripcion}</b>{referenciaDe(x) && <small>{referenciaDe(x)}</small>}{deOt(x)}</div> },
                { title: 'Cantidad', dataIndex: 'cantidad', align: 'right', width: 90 },
                { title: 'La OT se entrega', key: 'e', width: 160, render: (_, x) => <span className="evento-nombre">{x.ot.entrega ? fecha(`${x.ot.entrega}T12:00:00Z`) : '—'} <PlazoTag plazo={x.ot.plazo} />{x.ot.prioridad === 'urgent' && <span className="estado rojo">Urgente</span>}</span> },
                ...(veMontos ? [{ title: 'Costo', key: 'c', align: 'right' as const, width: 120, render: (_: unknown, x: RepuestoEnCompras) => (x.costo ? plata(Math.round(x.costo * x.cantidad)) : <span className="tenue">—</span>) }] : []),
                { title: 'Desde', dataIndex: 'creado', width: 110, render: (v: string) => <Hace iso={v} /> },
                ...(puede && tiene('supplies') ? [{ title: '', key: 'b', width: 1, render: (_: unknown, x: RepuestoEnCompras) => <Button size="small" type="text" onClick={() => setDeBodega(x)} title="Si hay uno guardado, se saca de bodega en vez de comprarlo">De bodega</Button> }] : []),
              ]}
            />
          </div>
        ))}
      </Bloque>
      {insumosBajos.length > 0 && (
        <Bloque
          titulo={`Insumos bajo el mínimo (${insumosBajos.length})`}
          extra={
            puede ? (
              <Button onClick={() => { if (!insumosElegidos.length) setInsumosElegidos(insumosBajos.map((x) => x.id)); setPidiendo(true) }}>
                {insumosElegidos.length ? `Pedir ${plural(insumosElegidos.length, 'insumo')}` : 'Pedir todos'}
              </Button>
            ) : null
          }
        >
          <Table<InsumoBajo>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={insumosBajos}
            scroll={{ x: 720 }}
            rowSelection={puede ? { selectedRowKeys: insumosElegidos, onChange: (k) => setInsumosElegidos(k as string[]) } : undefined}
            columns={[
              { title: 'Insumo', key: 'n', render: (_, x) => <div className="fila-nombre"><b>{x.nombre}</b>{referenciaDe(x) && <small>{referenciaDe(x)}</small>}</div> },
              { title: 'Hay', key: 'h', align: 'right', width: 130, render: (_, x) => <span><b style={{ color: 'var(--rojo)' }}>{cifra(x.stock)}</b> <span className="tenue">/ mín. {cifra(x.minimo)} {x.unidad}</span></span> },
              { title: 'Viene', dataIndex: 'porLlegar', align: 'right', width: 90, render: (v: number) => (v ? cifra(v) : <span className="tenue">—</span>) },
              { title: 'Conviene pedir', key: 's', align: 'right', width: 130, render: (_, x) => `${cifra(x.sugerido)} ${x.unidad}` },
              ...(veMontos ? [{ title: 'Proveedor', dataIndex: 'proveedor', width: 190, render: (v: string | null) => v ?? <span className="tenue">Sin proveedor</span> }] : []),
            ]}
          />
        </Bloque>
      )}
{veMontos && <CostosPorProveedor />}
      <Bloque titulo="Órdenes de compra" extra={<span className="tenue">Por retirar y las últimas cerradas. Abre una para recibir por partes.</span>}>
        <Table<OrdenDeCompra>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={ordenes}
          scroll={{ x: 980 }}
          locale={{ emptyText: 'Todavía no hay órdenes de compra.' }}
          expandable={{
            rowExpandable: (o) => o.repuestos.length + o.insumos.length > 0,
            expandedRowRender: (o) => (
              <>
              {veMontos && puede && o.estado !== 'cancelled' && <Factura valor={o.factura} guardar={(factura) => anotar.mutate({ id: o.id, datos: { factura } })} />}
              {o.insumos.length > 0 && (
                <Table<LineaInsumoOc>
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={o.insumos}
                  columns={[
                    { title: 'Insumo de bodega', key: 'n', render: (_, x) => x.nombre },
                    { title: 'Cantidad', key: 'c', align: 'right', width: 120, render: (_, x) => `${cifra(x.cantidad)} ${x.unidad}` },
                    { title: 'Estado', key: 'e', width: 130, render: (_, x) => <EstadoRepuestoTag compra="shop" estado={x.estado} /> },
                    { title: 'Llegó', dataIndex: 'recibido', width: 120, render: (v: string | null) => (v ? fecha(v) : <span className="tenue">—</span>) },
                    ...(veMontos
                      ? [
                          { title: 'Costo cotizado', key: 'cc', align: 'right' as const, width: 120, render: (_: unknown, x: LineaInsumoOc) => (x.costo ? plata(x.costo) : <span className="tenue">—</span>) },
                          { title: 'Costo real', key: 'cr', align: 'right' as const, width: 140, render: (_: unknown, x: LineaInsumoOc) => <CostoReal valor={x.costoReal} cotizado={x.costo} editable={puede && o.estado !== 'cancelled'} guardar={(costo) => anotar.mutate({ id: o.id, datos: { insumos: [{ id: x.id, costo }] } })} /> },
                        ]
                      : []),
                    {
                      title: '',
                      key: 'x',
                      width: 1,
                      render: (_, x) =>
                        x.estado === 'ordered' && recibe(o) ? (
                          <Button size="small" loading={recibirOc.isPending && recibirOc.variables?.insumos?.[0] === x.id} onClick={() => recibirOc.mutate({ id: o.id, insumos: [x.id] })}>
                            Recibido
                          </Button>
                        ) : null,
                    },
                  ]}
                />
              )}
              {o.repuestos.length > 0 && <Table<RepuestoEnCompras>
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={o.repuestos}
                columns={[
                  { title: 'Repuesto', key: 'n', render: (_, x) => <div className="fila-nombre"><span>{x.descripcion}</span>{referenciaDe(x) && <small>{referenciaDe(x)}</small>}{deOt(x)}</div> },
                  { title: 'Cantidad', dataIndex: 'cantidad', align: 'right', width: 90 },
                  { title: 'Estado', key: 'e', width: 130, render: (_, x) => <EstadoRepuestoTag compra={x.compra} estado={x.estado} /> },
                  { title: 'Llegó', dataIndex: 'recibido', width: 120, render: (v: string | null) => (v ? fecha(v) : <span className="tenue">—</span>) },
                  ...(veMontos
                    ? [
                        { title: 'Costo cotizado', key: 'cc', align: 'right' as const, width: 120, render: (_: unknown, x: RepuestoEnCompras) => (x.costo ? plata(x.costo) : <span className="tenue">—</span>) },
                        { title: 'Costo real', key: 'cr', align: 'right' as const, width: 140, render: (_: unknown, x: RepuestoEnCompras) => <CostoReal valor={x.costoReal} cotizado={x.costo} editable={puede && o.estado !== 'cancelled'} guardar={(costo) => anotar.mutate({ id: o.id, datos: { repuestos: [{ id: x.id, costo }] } })} /> },
                      ]
                    : []),
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
              />}
              </>
            ),
          }}
          columns={[
            { title: 'Orden', dataIndex: 'numero', width: 90, render: (v: number, o) => (veMontos ? <Link to="/c/$portal/compras/ordenes/$id" params={{ portal, id: o.id }} title="Imprimir o guardar en PDF para el proveedor"><b>{folioOc(v)}</b></Link> : <b>{folioOc(v)}</b>) },
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
            { title: 'Repuestos', key: 'r', width: 110, render: (_, o) => { const todo = [...o.repuestos, ...o.insumos]; return `${todo.filter((x) => x.estado === 'received').length} de ${todo.filter((x) => x.estado !== 'cancelled').length} llegaron` } },
            { title: 'Estado', key: 'e', width: 120, render: (_, o) => <EstadoOcTag estado={o.estado} /> },
            { title: 'Emitida', dataIndex: 'creada', width: 110, render: (v: string) => fecha(v) },
            { title: 'Llega', dataIndex: 'llega', width: 110, render: (v: string | null) => (v ? fecha(`${v}T12:00:00Z`) : <span className="tenue">—</span>) },
            ...(veMontos ? [{ title: 'Costo', key: 'costo', align: 'right' as const, width: 130, render: (_: unknown, o: OrdenDeCompra) => (o.costoReal ? <div className="fila-nombre"><span>{plata(o.costoReal)}</span>{o.costo !== o.costoReal && o.costo ? <small>cotizado {plata(o.costo)}</small> : null}{o.factura ? <small>{o.factura}</small> : null}</div> : <span className="tenue">—</span>) }] : []),
            {
              title: '',
              key: 'x',
              width: 1,
              render: (_, o) =>
                o.estado === 'open' ? (
                  <span className="botones-tarea">
                    {recibe(o) && (
                      <Button size="small" loading={recibirOc.isPending && recibirOc.variables?.id === o.id && !recibirOc.variables.repuestos && !recibirOc.variables.insumos} onClick={() => recibirOc.mutate({ id: o.id })}>
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
          insumos={insumosBajos.filter((x) => insumosElegidos.includes(x.id))}
          personas={personas.data ?? []}
          cerrar={(listo) => {
            setPidiendo(false)
            if (listo) {
              setElegidos([])
              setInsumosElegidos([])
            }
          }}
        />
      )}
      {anulando && <AnularOrden o={anulando} cerrar={() => setAnulando(null)} />}
      {deBodega && <DeBodega repuesto={deBodega} cerrar={() => setDeBodega(null)} />}
    </>
  )
}

/** Lo que de verdad se pagó por unidad. Quien gestiona lo anota (al salir del campo se guarda); los demás lo leen. */
function CostoReal({ valor, cotizado, editable, guardar }: { valor: number | null; cotizado: number | null; editable: boolean; guardar: (v: number | null) => void }) {
  const [v, setV] = useState<number | null>(valor)
  const distinto = valor !== null && cotizado !== null && valor !== cotizado
  if (!editable) return valor ? <span style={distinto ? { color: valor > (cotizado ?? 0) ? 'var(--naranjo)' : 'var(--verde)' } : undefined}>{plata(valor)}</span> : <span className="tenue">—</span>
  return (
    <InputNumber
      size="small"
      min={0}
      step={1000}
      value={v ?? undefined}
      placeholder={cotizado ? String(cotizado) : 'Anotar'}
      style={{ width: 120 }}
      onChange={(x) => setV(x ?? null)}
      onBlur={() => v !== valor && guardar(v)}
      onPressEnter={() => v !== valor && guardar(v)}
    />
  )
}

/** El número de la factura o guía con que llegó la orden. */
function Factura({ valor, guardar }: { valor: string | null; guardar: (v: string) => void }) {
  const [v, setV] = useState(valor ?? '')
  return (
    <div className="factura-oc">
      <span className="tenue">Factura o guía</span>
      <Input size="small" style={{ width: 160 }} value={v} placeholder="N° del documento" onChange={(e) => setV(e.target.value)} onBlur={() => v !== (valor ?? '') && guardar(v)} onPressEnter={() => v !== (valor ?? '') && guardar(v)} />
      <span className="tenue">Anota el costo real de cada línea con lo que dice el documento.</span>
    </div>
  )
}

type Comparacion = { dias: number; proveedores: { proveedor: string; lineas: number; porAnotar: number; cotizado: number; real: number; diferencia: number; fraccion: number | null }[] }

/** El costo real contra lo cotizado, por proveedor, de lo que llegó en los últimos 90 días. */
function CostosPorProveedor() {
  const r = useQuery({ queryKey: ['taller', 'costos'], queryFn: () => api<Comparacion>('GET', '/servicio/compras/costos?dias=90') })
  if (!r.data?.proveedores.length) return null
  return (
    <Bloque titulo="Costo real contra lo cotizado" extra={<span className="tenue">Repuestos que llegaron en los últimos {r.data.dias} días</span>}>
      <Table
        size="small"
        rowKey="proveedor"
        pagination={false}
        dataSource={r.data.proveedores}
        scroll={{ x: 720 }}
        columns={[
          { title: 'Proveedor', dataIndex: 'proveedor' },
          { title: 'Cotizado', dataIndex: 'cotizado', align: 'right', width: 130, render: (v: number) => plata(v) },
          { title: 'Pagado', dataIndex: 'real', align: 'right', width: 130, render: (v: number) => plata(v) },
          {
            title: 'Diferencia',
            key: 'd',
            align: 'right',
            width: 150,
            render: (_, g) =>
              g.cotizado ? (
                <b style={{ color: g.diferencia > 0 ? 'var(--naranjo)' : g.diferencia < 0 ? 'var(--verde)' : undefined }}>
                  {g.diferencia > 0 ? '+' : ''}
                  {plata(g.diferencia)}
                  {g.fraccion !== null ? ` (${g.diferencia > 0 ? '+' : ''}${(g.fraccion * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 })} %)` : ''}
                </b>
              ) : (
                <span className="tenue">—</span>
              ),
          },
          { title: 'Por anotar', dataIndex: 'porAnotar', align: 'right', width: 110, render: (v: number, g) => (v ? `${v} de ${g.lineas}` : <span className="tenue">0</span>) },
        ]}
      />
    </Bloque>
  )
}

/** Sacar de bodega un repuesto por pedir: los artículos que alcanzan, los más parecidos primero. */
function DeBodega({ repuesto, cerrar }: { repuesto: RepuestoEnCompras; cerrar: () => void }) {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [elegido, setElegido] = useState<string>()
  const r = useQuery({ queryKey: ['taller', 'insumos'], queryFn: () => api<Insumo[]>('GET', '/servicio/insumos') })
  const sacar = useMutation({
    mutationFn: () => api('POST', `/servicio/repuestos/${repuesto.id}/de-bodega`, { insumoId: elegido }),
    onSuccess: async () => {
      message.success('Sacado de bodega: el trabajo que lo esperaba ya puede seguir.')
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  const lista = candidatosDeBodega(r.data ?? [], repuesto)
  return (
    <Modal open title={`Sacar de bodega: ${repuesto.descripcion}`} okText="Sacar de bodega" okButtonProps={{ disabled: !elegido }} cancelText="Cancelar" onCancel={cerrar} confirmLoading={sacar.isPending} onOk={() => sacar.mutate()} destroyOnHidden>
      {sacar.isError && <Alert type="error" showIcon title={(sacar.error as Error).message} style={{ marginBottom: 12 }} />}
      <p className="tenue" style={{ marginTop: 0 }}>
        Lleva {cifra(repuesto.cantidad)}
        {referenciaDe(repuesto) ? ` · ${referenciaDe(repuesto)}` : ''} · {folioOt(repuesto.ot.numero)}
      </p>
      {r.isPending ? (
        <Cargando />
      ) : lista.length ? (
        <Radio.Group className="lista-opciones" value={elegido} onChange={(e) => setElegido(e.target.value)}>
          {lista.map((a) => (
            <Radio key={a.id} value={a.id}>
              <b>{a.nombre}</b> <span className="tenue">· hay {cifra(a.stock)} {a.unidad}</span> {a.parecido && <Estado tono="azul">Parecido</Estado>}
              {referenciaDe(a) && <small className="tenue">{referenciaDe(a)}</small>}
            </Radio>
          ))}
        </Radio.Group>
      ) : (
        <p>No hay en bodega nada que alcance. Se pide al proveedor.</p>
      )}
    </Modal>
  )
}

type DatosOrden = { proveedorId: string; choferId?: string; llega?: dayjs.Dayjs | null; nota?: string }

/** Emitir la orden de compra con lo elegido: a qué proveedor de la lista, quién va a buscarlo y cuándo llega. */
function NuevaOrden({ repuestos, insumos, personas, cerrar }: { repuestos: RepuestoEnCompras[]; insumos: InsumoBajo[]; personas: Persona[]; cerrar: (listo: boolean) => void }) {
  const [form] = Form.useForm<DatosOrden>()
  // Cuánto pedir de cada insumo: lo que conviene, y se puede cambiar.
  const [cantidades, setCantidades] = useState<Record<string, number>>(() => Object.fromEntries(insumos.map((x) => [x.id, x.sugerido])))
  const consultas = useQueryClient()
  const { message } = App.useApp()
  // Si todo lo elegido se cotizó con el mismo proveedor, la orden parte con él.
  const proveedores = [...new Set([...repuestos, ...insumos].map((x) => x.proveedorId ?? x.proveedor).filter((p): p is string => Boolean(p)))]
  const cotizado = proveedores.length === 1 ? ([...repuestos, ...insumos].find((x) => x.proveedorId)?.proveedorId ?? undefined) : undefined
  const emitir = useMutation({
    mutationFn: (v: DatosOrden) => api<{ numero: number }>('POST', '/servicio/compras/ordenes', { repuestos: repuestos.map((x) => x.id), insumos: insumos.map((x) => ({ insumoId: x.id, cantidad: cantidades[x.id] ?? x.sugerido })), proveedorId: v.proveedorId, choferId: v.choferId ?? null, llega: v.llega ? v.llega.format('YYYY-MM-DD') : null, nota: v.nota }),
    onSuccess: async (r) => {
      message.success(`${folioOc(r.numero)} emitida: queda por retirar.`)
      cerrar(true)
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  return (
    <Modal open title="Orden de compra" okText="Emitir la orden" cancelText="Cancelar" onCancel={() => cerrar(false)} confirmLoading={emitir.isPending} onOk={() => form.validateFields().then((v) => emitir.mutate(v))} destroyOnHidden width={600}>
      {emitir.isError && <Alert type="error" showIcon title={(emitir.error as Error).message} style={{ marginBottom: 12 }} />}
      {proveedores.length > 1 && <Alert type="warning" showIcon title={`Lo elegido es de ${proveedores.length} proveedores: la orden va a uno solo.`} style={{ marginBottom: 12 }} />}
      <ul className="lista-simple">
        {repuestos.map((x) => (
          <li key={x.id}>
            {x.cantidad} × {x.descripcion}
            {referenciaDe(x) ? ` · ${referenciaDe(x)}` : ''} <span className="tenue">({folioOt(x.ot.numero)})</span>
          </li>
        ))}
        {insumos.map((x) => (
          <li key={x.id} className="linea-insumo">
            <InputNumber size="small" min={1} max={1_000_000} value={cantidades[x.id]} onChange={(v) => setCantidades({ ...cantidades, [x.id]: v ?? x.sugerido })} style={{ width: 90 }} /> {x.unidad} × {x.nombre} <span className="tenue">(bodega: hay {cifra(x.stock)}, mínimo {cifra(x.minimo)})</span>
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
