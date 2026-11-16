// Las órdenes de trabajo y la recepción de un motor. Arriba, una franja con las etapas de las abiertas (recepción,
// esperando aprobación, en taller, calidad, listas), cada una con cuántas hay y cuántas atrasadas; tocar una deja solo
// esa. Debajo, una fila corta por OT (folio, cliente y motor, en qué está, avance y cuándo se entrega), ordenada por
// entrega (lo atrasado arriba), por número o por cliente. Lo elegido viaja en la dirección.
import { CloseOutlined, RightOutlined } from '@ant-design/icons'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Alert, Button, Checkbox, DatePicker, Form, Input, Modal, Pagination, Select } from 'antd'
import dayjs from 'dayjs'
import { api, consulta } from '../../../pantallas/api'
import { Cargando, Problema } from '../../../pantallas/componentes'
import { cifra, fecha, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { type EstadoOt, type Pieza, PRIORIDADES_OT } from '../reglas'
import { usePiezas } from './Piezas'
import { AvanceOt, CamposDelMotor, cuandoSeEntrega, EstadoOtTag, folioOt, usePersona, usePortal } from './comun'
import type { Cliente, FilaOt } from './tipos'

const ruta = getRouteApi('/c/$portal/ot')

/** Las etapas de una OT abierta, en el orden en que pasa por ellas. */
const ETAPAS = {
  recepcion: { nombre: 'Recepción', detalle: 'en diagnóstico', estados: ['received', 'diagnosis'], marca: '' },
  aprobacion: { nombre: 'Por aprobar', detalle: 'esperan al cliente', estados: ['waiting_approval'], marca: 'ind-fila' },
  taller: { nombre: 'En taller', detalle: 'trabajándose', estados: ['in_progress'], marca: 'ind-trabajando' },
  calidad: { nombre: 'Calidad', detalle: 'por revisar', estados: ['quality'], marca: 'ind-trabajando' },
  listas: { nombre: 'Listas', detalle: 'por retirar', estados: ['ready'], marca: 'ind-listo' },
} satisfies Record<string, { nombre: string; detalle: string; estados: EstadoOt[]; marca: string }>
type Etapa = keyof typeof ETAPAS

/** Qué se ve: las abiertas (o una etapa), las entregadas, las anuladas o todas. */
const VER = { abiertas: 'Abiertas', delivered: 'Entregadas', cancelled: 'Anuladas', todas: 'Todas' } as const
type Ver = keyof typeof VER

const ORDENES = { entrega: 'Entrega', numero: 'Número', cliente: 'Cliente' } as const
type Orden = keyof typeof ORDENES

type Respuesta = { total: number; etapas: Partial<Record<EstadoOt, { cuantas: number; atrasadas: number }>>; filas: FilaOt[] }

export function OrdenesDeTrabajo() {
  const b = ruta.useSearch()
  const portal = usePortal()
  const { gestiona } = usePersona()
  const ir = useNavigate({ from: '/c/$portal/ot' })
  const etapa = (Object.keys(ETAPAS) as Etapa[]).find((e) => ETAPAS[e].estados.join(',') === b.estado)
  const ver: Ver = !b.estado || etapa ? 'abiertas' : b.estado in VER ? (b.estado as Ver) : 'todas'
  // Lo abierto se mira por cuándo se entrega; lo cerrado, de lo más nuevo a lo más antiguo.
  const ordenPorOmision: Orden = ver === 'abiertas' ? 'entrega' : 'numero'
  const orden: Orden = b.orden && b.orden in ORDENES ? (b.orden as Orden) : ordenPorOmision
  const filtros = { estado: b.estado ?? 'abiertas', q: b.q, pagina: b.pagina, delMes: b.delMes, orden }
  const r = useQuery({ queryKey: ['taller', 'ots', filtros], queryFn: () => api<Respuesta>('GET', `/servicio/ot${consulta(filtros)}`), placeholderData: keepPreviousData })
  const cambiar = (c: Partial<typeof b>) => ir({ search: { ...b, pagina: undefined, ...c }, replace: true })

  const cuantasDe = (e: Etapa) => ETAPAS[e].estados.reduce((s, x) => s + (r.data?.etapas[x]?.cuantas ?? 0), 0)
  const atrasadasDe = (e: Etapa) => ETAPAS[e].estados.reduce((s, x) => s + (r.data?.etapas[x]?.atrasadas ?? 0), 0)
  const abiertas = (Object.keys(ETAPAS) as Etapa[]).reduce((s, e) => s + cuantasDe(e), 0)
  const atrasadas = (Object.keys(ETAPAS) as Etapa[]).reduce((s, e) => s + atrasadasDe(e), 0)
  const total = r.data?.total ?? 0

  return (
    <>
      <Encabezado
        titulo="Órdenes de trabajo"
        sub={r.data ? `${plural(abiertas, 'abierta')}${atrasadas ? ` · ${plural(atrasadas, 'atrasada')}` : ''}` : undefined}
        acciones={gestiona ? <Button type="primary" onClick={() => ir({ search: { ...b, recibir: '1' } })}>Recibir motor</Button> : null}
      />

      <div className="panel-indicadores solos etapas-ot" role="group" aria-label="Filtrar por etapa">
        {(Object.keys(ETAPAS) as Etapa[]).map((e) => {
          const n = cuantasDe(e)
          const tarde = atrasadasDe(e)
          return (
            <button key={e} type="button" className={`indicador ${ETAPAS[e].marca}${etapa === e ? ' elegido' : ''}`} aria-pressed={etapa === e} onClick={() => cambiar({ estado: etapa === e ? undefined : ETAPAS[e].estados.join(','), delMes: undefined, orden: undefined })}>
              <span className="indicador-nombre">{ETAPAS[e].nombre}</span>
              <span className="indicador-numero">{r.data ? cifra(n) : '—'}</span>
              <span className="indicador-pie">{tarde ? <b>{plural(tarde, 'atrasada')}</b> : ETAPAS[e].detalle}</span>
            </button>
          )
        })}
      </div>

      <div className="filtros lista-ots-filtros">
        <Input.Search className="buscar" placeholder="OT, cliente, motor, número o patente" defaultValue={b.q} allowClear onSearch={(q) => cambiar({ q: q || undefined })} />
        <span className="lista-barra-orden" role="group" aria-label="Qué órdenes ver">
          <span className="tenue">Ver</span>
          {(Object.keys(VER) as Ver[]).map((v) => (
            <button key={v} type="button" aria-pressed={ver === v} onClick={() => cambiar({ estado: v === 'abiertas' ? undefined : v, delMes: undefined, orden: undefined })}>
              {VER[v]}
            </button>
          ))}
        </span>
      </div>

      <div className="lista-barra">
        <span className="lista-barra-cuenta">
          {r.data ? `${cifra(total)} OT` : 'Órdenes'}
          {etapa && (
            <button type="button" className="filtro-puesto" onClick={() => cambiar({ estado: undefined })}>
              {ETAPAS[etapa].nombre} <CloseOutlined />
            </button>
          )}
          {b.delMes && (
            <button type="button" className="filtro-puesto" onClick={() => cambiar({ delMes: undefined })}>
              Entregadas este mes <CloseOutlined />
            </button>
          )}
          {b.q && (
            <button type="button" className="filtro-puesto" onClick={() => cambiar({ q: undefined })}>
              «{b.q}» <CloseOutlined />
            </button>
          )}
        </span>
        <span className="lista-barra-orden" role="group" aria-label="Ordenar">
          <span className="tenue">Ordenar por</span>
          {(Object.keys(ORDENES) as Orden[]).map((o) => (
            <button key={o} type="button" aria-pressed={orden === o} onClick={() => cambiar({ orden: o === ordenPorOmision ? undefined : o })}>
              {ORDENES[o]}
            </button>
          ))}
        </span>
      </div>

      {r.isError && <Problema error={r.error} />}
      {r.isPending ? (
        <Cargando />
      ) : (
        r.data && (
          <div className={`lista-panel lista-ots${r.isPlaceholderData ? ' actualizando' : ''}`}>
            {r.data.filas.length ? (
              <>
                <div className="fila-panel encabezado-panel" aria-hidden>
                  <span>OT</span>
                  <span>Cliente y motor</span>
                  <span>En qué está</span>
                  <span>Avance</span>
                  <span>Entrega</span>
                  <span />
                </div>
                {r.data.filas.map((o) => (
                  <FilaDeOt key={o.id} o={o} portal={portal} />
                ))}
              </>
            ) : (
              <p className="lista-panel-vacia">{b.q ? `Ninguna OT coincide con «${b.q}».` : ver === 'abiertas' && !etapa ? 'No hay OT abiertas. Cuando llegue un motor, recíbelo para partir.' : 'No hay OT con estos filtros.'}</p>
            )}
          </div>
        )
      )}
      {total > 50 && <Pagination className="paginas" align="center" total={total} current={b.pagina ?? 1} pageSize={50} showSizeChanger={false} onChange={(p) => ir({ search: { ...b, pagina: p === 1 ? undefined : p }, replace: true })} />}
      {b.recibir && <Recepcion cerrar={() => ir({ search: { ...b, recibir: undefined }, replace: true })} />}
    </>
  )
}

/** Una OT en una línea: lo que se pregunta en el mesón. Tocarla abre su ficha. */
function FilaDeOt({ o, portal }: { o: FilaOt; portal: string }) {
  const pz = usePiezas()
  const abierta = o.estado !== 'delivered' && o.estado !== 'cancelled'
  const entrega = o.estado === 'delivered' ? { texto: fecha(o.entregada) } : o.estado === 'cancelled' ? { texto: '—' } : cuandoSeEntrega(o.entrega)
  const tono = 'tono' in entrega ? entrega.tono : undefined
  const piezas = (o.piezas ?? []).map(pz.nombre).join(', ')
  return (
    <Link to="/c/$portal/ot/$id" params={{ portal, id: o.id }} className="fila-panel">
      <span className="fila-panel-ot">{folioOt(o.numero)}</span>
      <span className="fila-panel-que">
        <b>{o.cliente}</b>
        <small>
          {o.motor}
          {o.equipo ? ` · ${o.equipo}` : ''}
          {piezas && piezas !== pz.nombre('motor') ? ` · ${piezas}` : ''}
        </small>
      </span>
      <span className="fila-panel-estado">
        <EstadoOtTag estado={o.estado} />
        <DetalleDeEstado o={o} />
      </span>
      <span className="fila-ot-avance" title={o.total ? `${o.hechas} de ${o.total} trabajos terminados` : undefined}>
        <AvanceOt estado={o.estado} fraccion={o.avance ?? 0} ancho={64} />
      </span>
      <span className={`fila-panel-cuando${tono ? ` tono-${tono}` : ''}`}>
        {entrega.texto}
        {abierta && o.prioridad === 'urgent' && <i>Urgente</i>}
      </span>
      <RightOutlined className="atencion-flecha" />
    </Link>
  )
}

/** La segunda línea del estado: lo que la frena o lo que viene. */
function DetalleDeEstado({ o }: { o: FilaOt }) {
  if (o.detenidas) return <small className="problema-texto">{o.detenidas === 1 ? '1 trabajo detenido' : `${o.detenidas} trabajos detenidos`}</small>
  const texto =
    o.estado === 'received' || o.estado === 'diagnosis'
      ? o.total
        ? `diagnóstico: ${o.hechas} de ${o.total}`
        : undefined
      : o.estado === 'waiting_approval'
        ? 'espera la respuesta del cliente'
        : o.estado === 'in_progress' && o.total
          ? `${o.hechas} de ${o.total} trabajos`
          : o.estado === 'quality'
            ? 'falta aprobarla'
            : o.estado === 'ready'
              ? 'falta que la retiren'
              : undefined
  return texto ? <small>{texto}</small> : null
}

type DatosRecepcion = { clienteId: string; motor: string; numeroMotor?: string; equipo?: string; piezas: Pieza[]; cilindros?: number; valvulasPorCilindro?: number; culatas?: number; falla?: string; entrega?: { format: (f: string) => string }; prioridad: 'normal' | 'urgent'; diagnostico: boolean }

/** Recibir un motor o sus piezas: nace la OT con su diagnóstico. Los cilindros, válvulas y culatas cuentan las actividades al cotizar. */
function Recepcion({ cerrar }: { cerrar: () => void }) {
  const [form] = Form.useForm<DatosRecepcion>()
  const portal = usePortal()
  const ir = useNavigate()
  const consultas = useQueryClient()
  const clientes = useQuery({ queryKey: ['taller', 'clientes'], queryFn: () => api<Cliente[]>('GET', '/servicio/clientes') })
  const pz = usePiezas()
  // La entrega que se puede comprometer, según lo que llegó y la cola de hoy de cada sección.
  const piezas = Form.useWatch('piezas', form) ?? []
  const cilindros = Form.useWatch('cilindros', form)
  const valvulas = Form.useWatch('valvulasPorCilindro', form)
  const culatas = Form.useWatch('culatas', form)
  const conDiagnostico = Form.useWatch('diagnostico', form) ?? true
  const consultaSugerida = consulta({ piezas, cilindros, valvulasPorCilindro: valvulas, culatas, diagnostico: conDiagnostico ? '1' : '0' })
  const sugerida = useQuery({ queryKey: ['taller', 'entrega-sugerida', consultaSugerida], queryFn: () => api<{ fecha: string; dias: number }>('GET', `/servicio/entrega-sugerida${consultaSugerida}`), enabled: piezas.length > 0 })
  const recibir = useMutation({
    mutationFn: (v: DatosRecepcion) => api<{ id: string }>('POST', '/servicio/ot', { ...v, entrega: v.entrega?.format('YYYY-MM-DD') ?? null }),
    onSuccess: async (r) => {
      await consultas.invalidateQueries({ queryKey: ['taller'] })
      ir({ to: '/c/$portal/ot/$id', params: { portal, id: r.id } })
    },
  })
  return (
    <Modal open title="Recibir motor o piezas" okText="Recibir y crear la OT" cancelText="Cancelar" onCancel={cerrar} confirmLoading={recibir.isPending} onOk={() => form.validateFields().then((v) => recibir.mutate(v))} destroyOnHidden width={620}>
      {recibir.isError && <Alert type="error" showIcon title={(recibir.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ piezas: ['motor'], prioridad: 'normal', diagnostico: true }}>
        <Form.Item label="Cliente" name="clienteId" rules={[{ required: true, message: 'Elige el cliente.' }]} extra="¿No está? Agrégalo en Clientes.">
          <Select showSearch optionFilterProp="label" loading={clientes.isPending} options={clientes.data?.map((c) => ({ value: c.id, label: c.nombre }))} />
        </Form.Item>
        <div className="columnas">
          <Form.Item label="Motor (marca y modelo)" name="motor" rules={[{ required: true, message: 'Escribe el motor.' }, { min: 2 }]}>
            <Input placeholder="Mercedes-Benz OM 457" />
          </Form.Item>
          <Form.Item label="Número de motor" name="numeroMotor">
            <Input />
          </Form.Item>
        </div>
        <CamposDelMotor />
        <Form.Item label="Equipo y patente" name="equipo">
          <Input placeholder="Bus Marcopolo · KJ-RT-54" />
        </Form.Item>
        <Form.Item label="Qué llegó" name="piezas" rules={[{ required: true, message: 'Marca qué piezas llegaron.' }]}>
          <Checkbox.Group options={pz.opciones} />
        </Form.Item>
        <Form.Item label="Falla que informa el cliente" name="falla">
          <Input.TextArea rows={2} />
        </Form.Item>
        <div className="columnas">
          <Form.Item
            label="Entrega comprometida"
            name="entrega"
            extra={
              sugerida.data ? (
                <span>
                  Con la cola de hoy: {fecha(`${sugerida.data.fecha}T12:00:00Z`)}{' '}
                  <button type="button" className="enlace" onClick={() => form.setFieldValue('entrega', dayjs(sugerida.data!.fecha))}>
                    Usar
                  </button>
                </span>
              ) : undefined
            }
          >
            <DatePicker style={{ width: '100%' }} format="DD-MM-YYYY" />
          </Form.Item>
          <Form.Item label="Prioridad" name="prioridad">
            <Select options={Object.entries(PRIORIDADES_OT).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        </div>
        <Form.Item name="diagnostico" valuePropName="checked">
          <Checkbox>Agregar el diagnóstico para cotizar: desarme, lavado y medición; si son piezas sueltas, prueba de fisuras (y la hidráulica, si viene la culata)</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  )
}
