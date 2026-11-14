// Una cotización. En borrador se arma: actividades de la lista (cada una con su pieza y su sección), repuestos y otros
// cargos, descuento, IVA y total. Las actividades se cuentan con los datos del motor: si se cambian los cilindros, las
// líneas por cilindro se cuentan de nuevo. «Desglose por pieza» trae lo típico de cada pieza. Cada repuesto dice quién
// lo compra (la rectificadora, a su proveedor y a un costo, o el cliente, que lo trae y no se cobra) y qué trabajo lo
// espera. Enviada, queda fija: se acepta (sus trabajos y repuestos pasan a la OT), se rechaza o se anula.
import { DeleteOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Alert, App, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Table } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Problema } from '../../../pantallas/componentes'
import { fecha, fechaHora, plata, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { desglose, type Linea, lineaDe, loTraeElCliente, recontar, TIPOS_LINEA, totales, faltasParaEnviar } from '../../comercial/reglas'
import { SelectorDeProveedor } from '../../compras/pantallas/Proveedores'
import { QUIEN_COMPRA, type QuienCompra } from '../../compras/reglas'
import { CILINDROS, type Pieza } from '../reglas'
import { usePiezas } from './Piezas'
import { comoSeCuenta, EstadoCotTag, EstadoOtTag, folioCot, folioOt, motorDeDatos, textoMotor, usePersona, usePortal } from './comun'
import type { Catalogo, Cliente, DetalleCotizacion, DetalleOt } from './tipos'

const ruta = getRouteApi('/c/$portal/cotizaciones/$id')

type Borrador = { clienteId?: string; otId: string | null; motor: string; cilindros: number | null; valvulasPorCilindro: number | null; culatas: number | null; lineas: Linea[]; descuento: number; notas: string }

export function Cotizacion() {
  const { id } = ruta.useParams()
  const { ot } = ruta.useSearch()
  const nueva = id === 'nueva'
  const r = useQuery({ queryKey: ['taller', 'cotizacion', id], queryFn: () => api<DetalleCotizacion>('GET', `/servicio/cotizaciones/${id}`), enabled: !nueva })
  const desdeOt = useQuery({ queryKey: ['taller', 'ot', ot], queryFn: () => api<DetalleOt>('GET', `/servicio/ot/${ot}`), enabled: nueva && Boolean(ot) })
  if (!nueva && r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  if (nueva && ot && desdeOt.isPending) return <Cargando />
  // Si la OT de origen no carga, se dice: no se abre un borrador vacío como si nada.
  if (nueva && ot && desdeOt.isError) return <Problema error={desdeOt.error} />
  if (!nueva && r.data!.estado !== 'draft') return <Documento q={r.data!} />
  const o = desdeOt.data
  const inicial: Borrador = r.data
    ? { clienteId: r.data.cliente.id, otId: r.data.otId, motor: r.data.motor, cilindros: r.data.cilindros, valvulasPorCilindro: r.data.valvulasPorCilindro, culatas: r.data.culatas, lineas: r.data.lineas, descuento: r.data.descuento, notas: r.data.notas ?? '' }
    : { clienteId: o?.cliente.id, otId: o?.id ?? null, motor: o?.motor ?? '', cilindros: o?.cilindros ?? null, valvulasPorCilindro: o?.valvulasPorCilindro ?? null, culatas: o?.culatas ?? null, lineas: [], descuento: 0, notas: '' }
  return <Editor key={id} id={nueva ? null : id} numero={r.data?.numero ?? null} inicial={inicial} />
}

function Editor({ id, numero, inicial }: { id: string | null; numero: number | null; inicial: Borrador }) {
  const portal = usePortal()
  const { gestiona, tiene } = usePersona()
  const conCompras = tiene('purchasing')
  const ir = useNavigate()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [b, setB] = useState<Borrador>(inicial)
  const pz = usePiezas()
  const [desglosando, setDesglosando] = useState(false)
  const catalogo = useQuery({ queryKey: ['taller', 'catalogo'], queryFn: () => api<Catalogo>('GET', '/servicio/catalogo') })
  const clientes = useQuery({ queryKey: ['taller', 'clientes'], queryFn: () => api<Cliente[]>('GET', '/servicio/clientes') })
  const otsDelCliente = useQuery({
    queryKey: ['taller', 'ots-cliente', b.clienteId],
    queryFn: () => api<{ id: string; numero: number; motor: string; estado: DetalleOt['estado']; cilindros: number | null; valvulasPorCilindro: number | null; culatas: number | null }[]>('GET', `/servicio/clientes/${b.clienteId}/ot`),
    enabled: Boolean(b.clienteId),
  })
  const laOt = useQuery({ queryKey: ['taller', 'ot', b.otId], queryFn: () => api<DetalleOt>('GET', `/servicio/ot/${b.otId}`), enabled: Boolean(b.otId) })
  const motor = motorDeDatos(b)
  const t = totales(b.lineas, b.descuento)
  const faltas = faltasParaEnviar(b.lineas)
  // La cotización nueva que ya se creó: si después falla el envío, reintentar la corrige en vez de crear otra.
  const creada = useRef<string | null>(null)
  const guardar = useMutation({
    mutationFn: async (enviar: boolean) => {
      if (!b.clienteId) throw new Error('Elige el cliente.')
      const datos = { clienteId: b.clienteId, otId: b.otId, motor: b.motor, cilindros: b.cilindros, valvulasPorCilindro: b.valvulasPorCilindro, culatas: b.culatas, lineas: b.lineas, descuento: b.descuento, notas: b.notas }
      const yaEsta = id ?? creada.current
      if (yaEsta) await api('POST', `/servicio/cotizaciones/${yaEsta}`, datos)
      const destino = yaEsta ?? (creada.current = (await api<{ id: string }>('POST', '/servicio/cotizaciones', datos)).id)
      if (enviar) await api('POST', `/servicio/cotizaciones/${destino}/enviar`)
      return { destino, enviar }
    },
    onSuccess: async ({ destino, enviar }) => {
      message.success(enviar ? 'Cotización enviada.' : 'Borrador guardado.')
      await consultas.invalidateQueries({ queryKey: ['taller'] })
      ir({ to: '/c/$portal/cotizaciones/$id', params: { portal, id: destino }, replace: !id })
    },
  })
  const cambiar = (i: number, cambio: Partial<Linea>) => setB({ ...b, lineas: b.lineas.map((l, j) => (j === i ? { ...l, ...cambio } : l)) })
  /** Otro motor (más cilindros, otras válvulas): las líneas que se cuentan por eso se cuentan de nuevo. */
  const cambiarMotor = (cambio: Partial<Pick<Borrador, 'cilindros' | 'valvulasPorCilindro' | 'culatas'>>) => {
    const nuevo = { ...b, ...cambio }
    setB({ ...nuevo, lineas: recontar(nuevo.lineas, motorDeDatos(nuevo)) })
  }
  const agregarTrabajo = (trabajoId: string) => {
    const x = catalogo.data?.trabajos.find((t) => t.id === trabajoId)
    if (x) setB({ ...b, lineas: [...b.lineas, lineaDe(x, motor)] })
  }
  const seccion = (sid: string | null) => catalogo.data?.secciones.find((s) => s.id === sid)?.nombre
  const grupos: Pieza[] = ['motor', ...pz.sueltasConInactivas]
  const opciones = grupos
    .map((p) => ({
      label: pz.nombre(p),
      options: (catalogo.data?.trabajos ?? [])
        .filter((t) => t.pieza === p && t.activo)
        .sort((x, y) => x.paso - y.paso)
        .map((t) => ({ value: t.id, label: `${t.codigo} · ${t.nombre}${t.precio ? ` · ${plata(t.precio)} por ${t.unidad}` : ' · precio a mano'}` })),
    }))
    .filter((g) => g.options.length)

  return (
    <>
      <Encabezado
        miga={<Link to="/c/$portal/cotizaciones" params={{ portal }}>Cotizaciones</Link>}
        titulo={numero ? `${folioCot(numero)} · borrador` : 'Nueva cotización'}
        acciones={
          gestiona ? (
            <>
              <Button loading={guardar.isPending && !guardar.variables} onClick={() => guardar.mutate(false)}>Guardar borrador</Button>
              <Button type="primary" disabled={faltas.length > 0} loading={guardar.isPending && guardar.variables} onClick={() => guardar.mutate(true)}>Enviar al cliente</Button>
            </>
          ) : null
        }
      />
      {guardar.isError && <Problema error={guardar.error} />}
      <Bloque titulo="Para quién y el motor">
        <div className="columnas-3">
          <Form.Item label="Cliente" layout="vertical">
            <Select showSearch optionFilterProp="label" value={b.clienteId} loading={clientes.isPending} options={clientes.data?.map((c) => ({ value: c.id, label: c.nombre }))} onChange={(v) => setB({ ...b, clienteId: v, otId: null })} />
          </Form.Item>
          <Form.Item label="Orden de trabajo (opcional)" layout="vertical" extra="Al aceptar, los trabajos pasan a esta OT. Sin OT, nace una nueva.">
            <Select
              allowClear
              value={b.otId ?? undefined}
              disabled={!b.clienteId}
              options={[
                ...(otsDelCliente.data?.map((o) => ({ value: o.id, label: `${folioOt(o.numero)} · ${o.motor}` })) ?? []),
                // Un borrador ligado a una OT que ya se cerró: que se vea su folio y no su id interno.
                ...(b.otId && laOt.data && !otsDelCliente.data?.some((o) => o.id === b.otId) ? [{ value: b.otId, label: `${folioOt(laOt.data.numero)} · cerrada` }] : []),
              ]}
              onChange={(v) => {
                const o = otsDelCliente.data?.find((x) => x.id === v)
                // La OT ya sabe su motor (después del diagnóstico): lo que dice se copia y las líneas se cuentan de nuevo.
                const nuevo = { ...b, otId: v ?? null, motor: o?.motor ?? b.motor, cilindros: o?.cilindros ?? b.cilindros, valvulasPorCilindro: o?.valvulasPorCilindro ?? b.valvulasPorCilindro, culatas: o?.culatas ?? b.culatas }
                setB({ ...nuevo, lineas: recontar(nuevo.lineas, motorDeDatos(nuevo)) })
              }}
            />
          </Form.Item>
          <Form.Item label="Motor" layout="vertical">
            <Input value={b.motor} onChange={(e) => setB({ ...b, motor: e.target.value })} placeholder="Mercedes-Benz OM 457" />
          </Form.Item>
        </div>
        <div className="columnas-3">
          <Form.Item label="Cilindros" layout="vertical" extra={b.cilindros ? undefined : 'Sin dato: se cuenta como 4.'}>
            <Select allowClear placeholder="4" value={b.cilindros ?? undefined} options={CILINDROS.map((n) => ({ value: n, label: String(n) }))} onChange={(v) => cambiarMotor({ cilindros: v ?? null })} />
          </Form.Item>
          <Form.Item label="Válvulas por cilindro" layout="vertical" extra={`${motor.cilindros * motor.valvulasPorCilindro} válvulas en total.`}>
            <Select allowClear placeholder="2" value={b.valvulasPorCilindro ?? undefined} options={[2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} onChange={(v) => cambiarMotor({ valvulasPorCilindro: v ?? null })} />
          </Form.Item>
          <Form.Item label="Culatas" layout="vertical">
            <InputNumber min={1} max={24} precision={0} placeholder="1" style={{ width: '100%' }} value={b.culatas ?? undefined} onChange={(v) => cambiarMotor({ culatas: v ?? null })} />
          </Form.Item>
        </div>
      </Bloque>
      <Bloque
        titulo="Trabajos y repuestos"
        extra={
          <>
            <Button onClick={() => setDesglosando(true)} disabled={catalogo.isPending}>Desglose por pieza</Button>
            <Select key={b.lineas.length} showSearch optionFilterProp="label" placeholder="Agregar actividad de la lista…" style={{ width: 360 }} value={null} options={opciones} onChange={(v) => v && agregarTrabajo(v)} />
            <Button onClick={() => setB({ ...b, lineas: [...b.lineas, { tipo: 'repuesto', trabajoId: null, seccionId: null, codigo: null, descripcion: '', cantidad: 1, precio: null, horas: 0, compra: 'shop', proveedorId: null, proveedor: null, costo: null, necesita: null }] })}>Agregar repuesto</Button>
            <Button onClick={() => setB({ ...b, lineas: [...b.lineas, { tipo: 'otro', trabajoId: null, seccionId: null, codigo: null, descripcion: '', cantidad: 1, precio: null, horas: 0 }] })}>Otro cargo</Button>
          </>
        }
      >
        <Table<Linea & { i: number }>
          size="small"
          rowKey="i"
          pagination={false}
          dataSource={b.lineas.map((l, i) => ({ ...l, i }))}
          scroll={{ x: 920 }}
          locale={{ emptyText: 'Agrega lo que dijo el diagnóstico, o usa «Desglose por pieza» y quita lo que no corresponda.' }}
          columns={[
            {
              title: 'Pieza',
              key: 't',
              width: 160,
              render: (_, l) =>
                l.tipo === 'trabajo' ? (
                  <div className="fila-nombre">
                    <Select size="small" style={{ width: 140 }} value={l.pieza ?? 'motor'} options={pz.opciones} labelRender={() => pz.nombre(l.pieza ?? 'motor')} onChange={(v) => cambiar(l.i, { pieza: v as Pieza })} />
                    <small>{seccion(l.seccionId)}</small>
                  </div>
                ) : l.tipo === 'repuesto' ? (
                  <div className="fila-nombre">
                    <Select
                      size="small"
                      style={{ width: 140 }}
                      value={l.compra ?? 'shop'}
                      options={Object.entries(QUIEN_COMPRA).map(([value, label]) => ({ value, label: value === 'shop' ? 'Lo compramos' : 'Lo trae el cliente' }))}
                      onChange={(v) => cambiar(l.i, v === 'customer' ? { compra: v as QuienCompra, precio: null, proveedorId: null, proveedor: null, costo: null } : { compra: v as QuienCompra })}
                    />
                    <small>Repuesto</small>
                  </div>
                ) : (
                  <span>{TIPOS_LINEA[l.tipo]}</span>
                ),
            },
            {
              title: 'Descripción',
              key: 'd',
              render: (_, l) => (
                <>
                  <Input size="small" value={l.descripcion} onChange={(e) => cambiar(l.i, { descripcion: e.target.value })} placeholder="Qué es" />
                  {l.tipo === 'repuesto' && (
                    <div className="linea-repuesto">
                      <Input size="small" style={{ width: 110 }} value={l.medida ?? ''} placeholder="Medida" title="STD, 0,25, 0,50…" onChange={(e) => cambiar(l.i, { medida: e.target.value || null })} />
                      {!loTraeElCliente(l) && <Input size="small" style={{ width: 120 }} value={l.marca ?? ''} placeholder="Marca" onChange={(e) => cambiar(l.i, { marca: e.target.value || null })} />}
                      {!loTraeElCliente(l) && <Input size="small" style={{ width: 130 }} value={l.numeroParte ?? ''} placeholder="N° de parte" onChange={(e) => cambiar(l.i, { numeroParte: e.target.value || null })} />}
                      {!loTraeElCliente(l) && conCompras && (
                        <SelectorDeProveedor
                          size="small"
                          style={{ width: 210 }}
                          value={l.proveedorId}
                          placeholder={l.proveedor && !l.proveedorId ? `${l.proveedor} (no está en la lista)` : 'Proveedor'}
                          onChange={(id, p) => cambiar(l.i, { proveedorId: id, proveedor: p?.nombre ?? null })}
                        />
                      )}
                      {!loTraeElCliente(l) && <InputNumber size="small" style={{ width: 130 }} min={0} step={1000} precision={0} value={l.costo ?? undefined} placeholder="Costo unitario" onChange={(v) => cambiar(l.i, { costo: v ?? null })} />}
                      <Select
                        size="small"
                        style={{ width: 220 }}
                        value={l.necesita ?? ''}
                        title="El trabajo que no se puede empezar hasta que llegue"
                        options={[{ value: '', label: 'Lo espera: el armado' }, ...b.lineas.filter((x) => x.tipo === 'trabajo' && x.codigo).map((x) => ({ value: x.codigo!, label: `Lo espera: ${x.descripcion}` }))]}
                        onChange={(v) => cambiar(l.i, { necesita: v || null })}
                      />
                    </div>
                  )}
                </>
              ),
            },
            {
              title: 'Cantidad',
              key: 'c',
              width: 130,
              render: (_, l) => (
                <div className="fila-nombre">
                  <InputNumber size="small" min={0.1} value={l.cantidad} onChange={(v) => cambiar(l.i, { cantidad: v ?? 1 })} />
                  {comoSeCuenta(l.criterio) && <small>{comoSeCuenta(l.criterio)}</small>}
                </div>
              ),
            },
            {
              title: 'Valor por unidad',
              key: 'p',
              width: 150,
              render: (_, l) =>
                loTraeElCliente(l) ? (
                  <span className="tenue">No se cobra</span>
                ) : (
                  <InputNumber size="small" min={0} step={1000} precision={0} value={l.precio ?? undefined} status={l.precio ? undefined : 'warning'} placeholder="Falta" style={{ width: 130 }} onChange={(v) => cambiar(l.i, { precio: v ?? null })} />
                ),
            },
            { title: 'Total', key: 'tot', align: 'right', width: 120, render: (_, l) => (l.precio && !loTraeElCliente(l) ? plata(Math.round(l.cantidad * l.precio)) : <span className="tenue">—</span>) },
            { title: '', key: 'x', width: 1, render: (_, l) => <Button size="small" type="text" icon={<DeleteOutlined />} aria-label="Quitar línea" onClick={() => {
                  // Los repuestos que esperaban esa actividad pasan a esperar el armado (no quedan apuntando a nada).
                  const quitada = b.lineas[l.i]
                  const quedan = b.lineas.filter((_, j) => j !== l.i)
                  const sigue = quedan.some((x) => x.tipo === 'trabajo' && x.codigo === quitada.codigo)
                  setB({ ...b, lineas: quedan.map((x) => (quitada.codigo && !sigue && x.necesita === quitada.codigo ? { ...x, necesita: null } : x)) })
                }} /> },
          ]}
        />
      </Bloque>
      <div className="columnas">
        <Bloque titulo="Notas para el cliente">
          <Input.TextArea rows={4} value={b.notas} onChange={(e) => setB({ ...b, notas: e.target.value })} placeholder="Plazo, garantía, condiciones de pago…" />
        </Bloque>
        <Bloque titulo="Totales">
          <Totales t={t} descuento={b.descuento} cambiarDescuento={(v) => setB({ ...b, descuento: v })} />
          {faltas.length > 0 && <Alert type="warning" showIcon title="Antes de enviar" description={faltas.join(' ')} style={{ marginTop: 10 }} />}
        </Bloque>
      </div>
      {desglosando && catalogo.data && (
        <Desglose
          catalogo={catalogo.data}
          llegaron={laOt.data?.piezas ?? null}
          textoDelMotor={textoMotor(motor) ?? ''}
          cerrar={() => setDesglosando(false)}
          agregar={(piezas) => {
            const diagnostico = new Set(catalogo.data.secciones.filter((s) => s.diagnostico).map((s) => s.id))
            const nuevas = desglose(catalogo.data.trabajos, piezas, motor, b.lineas, diagnostico, pz.propias)
            setB({ ...b, lineas: [...b.lineas, ...nuevas] })
            setDesglosando(false)
            if (nuevas.length) message.success(`Se agregaron ${nuevas.length} actividades, contadas para este motor. Quita lo que no corresponda.`)
            else message.info('Esas piezas ya tienen sus actividades típicas en la cotización.')
          }}
        />
      )}
    </>
  )
}

/** Elegir las piezas del desglose. Si se sabe qué llegó, parte con eso; un motor completo trae todo. */
function Desglose({ catalogo, llegaron, textoDelMotor, cerrar, agregar }: { catalogo: Catalogo; llegaron: Pieza[] | null; textoDelMotor: string; cerrar: () => void; agregar: (piezas: Pieza[]) => void }) {
  const pz = usePiezas()
  const conTipicas = (['motor', ...pz.sueltas] as Pieza[]).filter((p) => catalogo.trabajos.some((t) => t.pieza === p && t.tipico && t.activo))
  const inicial = !llegaron || llegaron.includes('motor') ? conTipicas : conTipicas.filter((p) => llegaron.includes(p))
  const [piezas, setPiezas] = useState<Pieza[]>(inicial)
  const cuantas = (p: Pieza) => catalogo.trabajos.filter((t) => t.pieza === p && t.tipico && t.activo).length
  return (
    <Modal open title="Desglose por pieza" okText="Agregar" cancelText="Cancelar" onCancel={cerrar} onOk={() => agregar(piezas)} okButtonProps={{ disabled: !piezas.length }} destroyOnHidden>
      <p className="tenue" style={{ marginTop: 0 }}>
        Trae las actividades típicas de cada pieza, contadas para {textoDelMotor || 'este motor'}. Lo que ya está en la cotización no se repite.
      </p>
      <Checkbox.Group value={piezas} onChange={(v) => setPiezas(v as Pieza[])} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {conTipicas.map((p) => (
          <Checkbox key={p} value={p}>
            {p === 'motor' ? 'Motor completo: desarme, medición, armado y control' : pz.nombre(p)} <span className="tenue">({plural(cuantas(p), 'actividad', 'actividades')})</span>
          </Checkbox>
        ))}
      </Checkbox.Group>
    </Modal>
  )
}

function Totales({ t, descuento, cambiarDescuento }: { t: ReturnType<typeof totales>; descuento: number; cambiarDescuento?: (v: number) => void }) {
  return (
    <dl className="ficha totales">
      <dt>Subtotal</dt>
      <dd>{plata(t.subtotal)}</dd>
      <dt>Descuento</dt>
      <dd>
        {cambiarDescuento ? <InputNumber size="small" min={0} max={100} precision={0} value={descuento} onChange={(v) => cambiarDescuento(v ?? 0)} suffix="%" style={{ width: 90 }} /> : `${descuento} %`}
        {t.rebaja ? ` · −${plata(t.rebaja)}` : ''}
      </dd>
      <dt>Neto</dt>
      <dd>{plata(t.neto)}</dd>
      <dt>IVA 19 %</dt>
      <dd>{plata(t.iva)}</dd>
      <dt>
        <b>Total</b>
      </dt>
      <dd>
        <b style={{ fontSize: 16 }}>{plata(t.total)}</b>
      </dd>
    </dl>
  )
}

/** La cotización enviada (o decidida): fija, con sus acciones. */
function Documento({ q }: { q: DetalleCotizacion }) {
  const portal = usePortal()
  const { gestiona, suspendida } = usePersona()
  const pz = usePiezas()
  const ir = useNavigate()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [dialogo, setDialogo] = useState<'aceptar' | 'rechazar' | 'anular' | null>(null)
  const [form] = Form.useForm<{ nota?: string }>()
  useEffect(() => {
    if (dialogo) form.resetFields()
  }, [dialogo, form])
  const decidir = useMutation({
    mutationFn: (v: { nota?: string }) => api<{ otId?: string }>('POST', `/servicio/cotizaciones/${q.id}/${dialogo === 'aceptar' ? 'aceptar' : dialogo === 'rechazar' ? 'rechazar' : 'anular'}`, v),
    onSuccess: async (r) => {
      message.success(dialogo === 'aceptar' ? 'Aceptada: los trabajos pasaron al taller, cada uno con su especialista.' : dialogo === 'rechazar' ? 'Rechazo registrado.' : 'Cotización anulada.')
      setDialogo(null)
      await consultas.invalidateQueries({ queryKey: ['taller'] })
      if (r.otId) ir({ to: '/c/$portal/ot/$id', params: { portal, id: r.otId } })
    },
  })
  const puede = gestiona && !suspendida
  const delMotor = textoMotor(q)
  return (
    <>
      <Encabezado
        miga={<Link to="/c/$portal/cotizaciones" params={{ portal }}>Cotizaciones</Link>}
        titulo={`${folioCot(q.numero)} · ${q.cliente.nombre}`}
        sub={
          <>
            <EstadoCotTag estado={q.estado} />
            <span>{q.motor}</span>
            {delMotor && <span>{delMotor}</span>}
            {q.enviada && <span>Enviada {fechaHora(q.enviada)}</span>}
            {q.ot && q.otId && (
              <Link to="/c/$portal/ot/$id" params={{ portal, id: q.otId }}>
                {folioOt(q.ot.numero)} <EstadoOtTag estado={q.ot.estado} />
              </Link>
            )}
          </>
        }
        acciones={
          <>
            <Link to="/c/$portal/cotizaciones/$id/imprimir" params={{ portal, id: q.id }}>
              <Button>Imprimir o PDF</Button>
            </Link>
            {puede && (q.estado === 'sent' || q.estado === 'draft') ? (
            <>
              {q.estado === 'sent' && <Button type="primary" onClick={() => setDialogo('aceptar')}>El cliente aceptó</Button>}
              {q.estado === 'sent' && <Button onClick={() => setDialogo('rechazar')}>El cliente rechazó</Button>}
              <Button danger onClick={() => setDialogo('anular')}>Anular</Button>
            </>
            ) : null}
          </>
        }
      />
      {q.nota && <Alert type={q.estado === 'accepted' ? 'success' : 'warning'} showIcon className="problema" title={`${q.estado === 'accepted' ? 'Aceptada' : q.estado === 'rejected' ? 'Rechazada' : 'Anulada'} ${fecha(q.decidida)}`} description={q.nota} />}
      <Bloque titulo="Detalle">
        <Table<Linea & { i: number }>
          size="small"
          rowKey="i"
          pagination={false}
          dataSource={q.lineas.map((l, i) => ({ ...l, i }))}
          scroll={{ x: 680 }}
          columns={[
            { title: 'Código', dataIndex: 'codigo', width: 80, render: (v: string | null) => v ?? '—' },
            { title: 'Descripción', key: 'd', render: (_, l) => <div className="fila-nombre"><span>{l.descripcion}</span>{l.tipo === 'trabajo' && l.pieza && <small>{pz.nombre(l.pieza)}</small>}{l.tipo === 'repuesto' && (l.medida || l.marca) && <small>{[l.medida, l.marca].filter(Boolean).join(' · ')}</small>}{loTraeElCliente(l) && <small>Lo trae el cliente</small>}</div> },
            { title: 'Tipo', dataIndex: 'tipo', render: (v: Linea['tipo']) => TIPOS_LINEA[v] },
            { title: 'Cantidad', key: 'c', align: 'right', render: (_, l) => <div className="fila-nombre"><span>{l.cantidad}</span>{comoSeCuenta(l.criterio) && <small>{comoSeCuenta(l.criterio)}</small>}</div> },
            { title: 'Valor por unidad', key: 'p', align: 'right', render: (_, l) => (loTraeElCliente(l) ? <span className="tenue">No se cobra</span> : l.precio ? plata(l.precio) : '—') },
            { title: 'Total', key: 't', align: 'right', render: (_, l) => (loTraeElCliente(l) ? <span className="tenue">—</span> : plata(Math.round(l.cantidad * (l.precio ?? 0)))) },
          ]}
        />
      </Bloque>
      <div className="columnas">
        <Bloque titulo="Notas">{q.notas ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{q.notas}</p> : <span className="tenue">Sin notas.</span>}</Bloque>
        <Bloque titulo="Totales">
          <Totales t={q} descuento={q.descuento} />
        </Bloque>
      </div>
      {dialogo && (
        <Modal
          open
          title={dialogo === 'aceptar' ? 'El cliente aceptó la cotización' : dialogo === 'rechazar' ? 'El cliente rechazó la cotización' : 'Anular la cotización'}
          okText={dialogo === 'aceptar' ? 'Aceptar y pasar al taller' : dialogo === 'rechazar' ? 'Registrar rechazo' : 'Anular'}
          okButtonProps={{ danger: dialogo === 'anular' }}
          cancelText="Cancelar"
          confirmLoading={decidir.isPending}
          onCancel={() => setDialogo(null)}
          onOk={() => form.validateFields().then((v) => decidir.mutate(v))}
          destroyOnHidden
        >
          {decidir.isError && <Alert type="error" showIcon title={(decidir.error as Error).message} style={{ marginBottom: 12 }} />}
          {dialogo === 'aceptar' && <p>Los trabajos cotizados pasan a {q.ot ? folioOt(q.ot.numero) : 'una OT nueva'}, cada uno a la ruta de su pieza y a uno de sus especialistas.</p>}
          <Form form={form} layout="vertical" requiredMark={false}>
            <Form.Item label={dialogo === 'aceptar' ? 'Cómo aceptó (opcional): OC, correo, teléfono…' : 'Motivo'} name="nota" rules={dialogo === 'aceptar' ? [] : [{ required: true, message: 'Escribe el motivo.' }, { min: 3 }]}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        </Modal>
      )}
    </>
  )
}
