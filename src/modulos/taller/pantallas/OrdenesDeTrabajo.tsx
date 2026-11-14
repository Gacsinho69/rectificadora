// Las órdenes de trabajo y la recepción de un motor. Por omisión, las abiertas, de la más nueva a la más antigua.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Alert, Button, Checkbox, DatePicker, Form, Input, Modal, Pagination, Select, Table } from 'antd'
import dayjs from 'dayjs'
import { api, consulta } from '../../../pantallas/api'
import { Cargando, Problema, useAngosto } from '../../../pantallas/componentes'
import { cifra, fecha } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { ESTADOS_OT, type Pieza, PRIORIDADES_OT } from '../reglas'
import { usePiezas } from './Piezas'
import { AvanceOt, CamposDelMotor, EstadoOtTag, folioOt, PlazoTag, usePersona, usePortal } from './comun'
import type { Cliente, FilaOt } from './tipos'

const ruta = getRouteApi('/c/$portal/ot')

export function OrdenesDeTrabajo() {
  const b = ruta.useSearch()
  const portal = usePortal()
  const { gestiona } = usePersona()
  const pz = usePiezas()
  const ir = useNavigate({ from: '/c/$portal/ot' })
  const filtros = { estado: b.estado ?? 'abiertas', q: b.q, pagina: b.pagina }
  const r = useQuery({ queryKey: ['taller', 'ots', filtros], queryFn: () => api<{ total: number; filas: FilaOt[] }>('GET', `/servicio/ot${consulta(filtros)}`), placeholderData: keepPreviousData })
  const estados = filtros.estado === 'abiertas' || filtros.estado === 'todas' ? [] : filtros.estado.split(',')
  const angosto = useAngosto()
  const abrir = (o: FilaOt) => ir({ to: '/c/$portal/ot/$id', params: { portal, id: o.id } })
  const entrega = (o: FilaOt) => (
    <span className="evento-nombre">
      {o.entrega ? fecha(`${o.entrega}T12:00:00Z`) : '—'} <PlazoTag plazo={o.plazo} />
      {o.prioridad === 'urgent' && <span className="estado rojo">Urgente</span>}
    </span>
  )
  const estado = (o: FilaOt) => (
    <span className="evento-nombre">
      <EstadoOtTag estado={o.estado} />
      {o.detenidas ? <span className="estado naranjo" title={`${o.detenidas} ${o.detenidas === 1 ? 'trabajo detenido' : 'trabajos detenidos'}`}>Detenida</span> : null}
    </span>
  )
  const paginas = { total: r.data?.total, current: b.pagina ?? 1, pageSize: 50, showSizeChanger: false, onChange: (p: number) => ir({ search: { ...b, pagina: p === 1 ? undefined : p }, replace: true }) }
  return (
    <>
      <Encabezado
        titulo="Órdenes de trabajo"
        sub={r.data ? `${cifra(r.data.total)} ${filtros.estado === 'abiertas' ? 'abiertas' : 'con estos filtros'}` : undefined}
        acciones={gestiona ? <Button type="primary" onClick={() => ir({ search: { ...b, recibir: '1' } })}>Recibir motor</Button> : null}
      />
      <div className="filtros">
        <Input.Search className="buscar" placeholder="OT, cliente, motor, número o patente" defaultValue={b.q} allowClear onSearch={(q) => ir({ search: { ...b, q: q || undefined, pagina: undefined }, replace: true })} />
        <Select
          style={{ minWidth: 200 }}
          value={estados.length ? undefined : filtros.estado}
          placeholder="Por estado"
          onChange={(v) => ir({ search: { ...b, estado: v === 'abiertas' ? undefined : v, pagina: undefined }, replace: true })}
          options={[{ value: 'abiertas', label: 'Abiertas' }, { value: 'todas', label: 'Todas' }]}
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="Estado"
          style={{ minWidth: 220 }}
          value={estados}
          options={Object.entries(ESTADOS_OT).map(([value, label]) => ({ value, label }))}
          onChange={(v) => ir({ search: { ...b, estado: v.length ? v.join(',') : undefined, pagina: undefined }, replace: true })}
        />
      </div>
      {r.isError && <Problema error={r.error} />}
      {angosto ? (
        // En el celular, una tarjeta por OT: lo que se pregunta en el mesón, sin una tabla que no cabe.
        r.isPending ? (
          <Cargando />
        ) : (
          <div className={`bloque${r.isPlaceholderData ? ' actualizando' : ''}`}>
            <div className="lista-tarjetas">
              {!r.data?.filas.length && <p className="tenue">No hay OT con estos filtros.</p>}
              {r.data?.filas.map((o) => (
                <article key={o.id} className={`tarjeta abre${o.plazo === 'atrasada' ? ' atrasada' : ''}`} onClick={() => abrir(o)}>
                  <div className="tarjeta-cabeza">
                    <b>{folioOt(o.numero)}</b>
                    {estado(o)}
                  </div>
                  <b className="tarjeta-trabajo">{o.cliente}</b>
                  <small>
                    {o.motor}
                    {o.equipo ? ` · ${o.equipo}` : ''}
                  </small>
                  <small>{(o.piezas ?? []).map(pz.nombre).join(', ')}</small>
                  <div className="tarjeta-pie">
                    <AvanceOt estado={o.estado} fraccion={o.avance ?? 0} ancho={60} />
                    {entrega(o)}
                  </div>
                </article>
              ))}
            </div>
            {(r.data?.total ?? 0) > 50 && <Pagination className="paginas" simple {...paginas} />}
          </div>
        )
      ) : (
      <div className="bloque">
        <Table<FilaOt>
          size="small"
          rowKey="id"
          loading={r.isFetching}
          dataSource={r.data?.filas}
          scroll={{ x: 980 }}
          rowClassName={() => 'fila-abre'}
          onRow={(o) => ({ onClick: () => abrir(o) })}
          pagination={paginas}
          columns={[
            { title: 'OT', key: 'n', width: 92, render: (_, o) => <b>{folioOt(o.numero)}</b> },
            { title: 'Cliente', dataIndex: 'cliente' },
            { title: 'Motor', key: 'm', render: (_, o) => <div className="fila-nombre"><span>{o.motor}</span>{o.equipo && <small>{o.equipo}</small>}</div> },
            { title: 'Piezas', key: 'p', render: (_, o) => (o.piezas ?? []).map(pz.nombre).join(', ') },
            { title: 'Estado', key: 'e', render: (_, o) => estado(o) },
            { title: 'Avance', key: 'a', render: (_, o) => <span title={`${o.hechas} de ${o.total} trabajos`}><AvanceOt estado={o.estado} fraccion={o.avance ?? 0} ancho={60} /></span> },
            { title: 'Recibida', key: 'c', render: (_, o) => fecha(o.creada) },
            { title: 'Entrega', key: 'en', render: (_, o) => entrega(o) },
          ]}
        />
      </div>
      )}
      {b.recibir && <Recepcion cerrar={() => ir({ search: { ...b, recibir: undefined }, replace: true })} />}
    </>
  )
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
