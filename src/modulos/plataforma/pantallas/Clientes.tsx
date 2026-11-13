// La lista de todos los clientes, con filtros y orden. Todo viaja en la dirección: una lista filtrada se comparte
// copiando el enlace, y el botón «atrás» vuelve a la misma vista.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Button, DatePicker, Input, Select, Table, Tooltip } from 'antd'
import type { SorterResult } from 'antd/es/table/interface'
import dayjs from 'dayjs'
import { useState } from 'react'
import { api, consulta } from '../../../pantallas/api'
import { Cargando, EstadoTenantTag, Hace, Medidor, PagoTag, Problema, SaludTag } from '../../../pantallas/componentes'
import { cifra, fecha, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import type { BusquedaClientes } from '../../../pantallas/rutas'
import { useYo } from '../../../pantallas/sesion'
import { PERMISOS_PLATAFORMA } from '../../acceso/permisos'
import { ESTADOS_SALUD } from '../../salud/reglas'
import { ESTADOS_PAGO, ESTADOS_TENANT, PLANES } from '../../tenants/reglas'
import { ACTIVIDAD, NIVELES_USO, type Orden } from '../listado'
import { NuevoCliente } from './NuevoCliente'
import type { ResumenTenant } from './tipos'

const ruta = getRouteApi('/plataforma/clientes')
const opciones = (o: Record<string, string | { nombre: string }>) => Object.entries(o).map(([value, v]) => ({ value, label: typeof v === 'string' ? v : v.nombre }))
const lista = (v?: string) => (v ? v.split(',') : [])

export function Clientes() {
  const b = ruta.useSearch()
  const ir = useNavigate({ from: '/plataforma/clientes' })
  const cambiar = (cambios: Partial<BusquedaClientes>) => ir({ search: (antes: BusquedaClientes) => ({ ...antes, pagina: undefined, ...cambios }), replace: true })
  const r = useQuery({
    queryKey: ['tenants', b],
    queryFn: () => api<{ total: number; filas: ResumenTenant[] }>('GET', `/plataforma/tenants${consulta(b)}`),
    placeholderData: keepPreviousData,
  })
  const orden = (b.orden ?? 'ultimoLogin') as Orden
  const dir = b.dir ?? 'desc'
  const ordenDe = (campo: Orden) => (orden === campo ? (dir === 'asc' ? 'ascend' : 'descend') : null)
  const hayFiltros = Object.entries(b).some(([k, v]) => v !== undefined && !['orden', 'dir', 'pagina', 'porPagina'].includes(k))
  const yo = useYo()
  const puedeCrear = yo.data?.actor?.tipo === 'plataforma' && yo.data.actor.permisos.includes('tenants.create')
  const [nuevo, setNuevo] = useState(false)

  return (
    <>
      <Encabezado
        titulo="Clientes"
        sub={r.data ? `${cifra(r.data.total)} ${hayFiltros ? 'con estos filtros' : 'en total'}` : undefined}
        acciones={
          <Tooltip title={puedeCrear ? undefined : `Te falta el permiso «${PERMISOS_PLATAFORMA['tenants.create']}»`}>
            <Button type="primary" disabled={!puedeCrear} onClick={() => setNuevo(true)}>
              Nueva rectificadora
            </Button>
          </Tooltip>
        }
      />
      {nuevo && <NuevoCliente cerrar={() => setNuevo(false)} />}
      <div className="filtros">
        <Input.Search className="buscar" placeholder="Nombre, correo o ID del cliente" defaultValue={b.q} allowClear onSearch={(q) => cambiar({ q: q || undefined })} />
        <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="Estado" value={lista(b.estado)} options={opciones(ESTADOS_TENANT)} onChange={(v) => cambiar({ estado: v.join(',') || undefined })} />
        <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="Plan" value={lista(b.plan)} options={opciones(PLANES)} onChange={(v) => cambiar({ plan: v.join(',') || undefined })} />
        <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="Estado de pago" value={lista(b.pago)} options={opciones(ESTADOS_PAGO)} onChange={(v) => cambiar({ pago: v.join(',') || undefined })} />
        <Select mode="multiple" allowClear maxTagCount="responsive" placeholder="Salud" value={lista(b.salud)} options={opciones(ESTADOS_SALUD)} onChange={(v) => cambiar({ salud: v.join(',') || undefined })} />
        <Select allowClear placeholder="Nivel de uso" value={b.uso} options={opciones(NIVELES_USO)} onChange={(v) => cambiar({ uso: v })} />
        <Select allowClear placeholder="Última actividad" value={b.actividad} options={opciones(ACTIVIDAD)} onChange={(v) => cambiar({ actividad: v })} style={{ minWidth: 210 }} />
        <DatePicker.RangePicker
          placeholder={['Creado desde', 'hasta']}
          value={[b.creadoDesde ? dayjs(b.creadoDesde) : null, b.creadoHasta ? dayjs(b.creadoHasta) : null]}
          onChange={(v) => cambiar({ creadoDesde: v?.[0]?.format('YYYY-MM-DD'), creadoHasta: v?.[1]?.format('YYYY-MM-DD') })}
        />
        {hayFiltros && (
          <Button type="link" onClick={() => ir({ search: {}, replace: true })}>
            Quitar filtros
          </Button>
        )}
      </div>
      {r.isError && <Problema error={r.error} />}
      {r.isPending ? (
        <Cargando />
      ) : (
        <div className="bloque">
          <Table<ResumenTenant>
            size="small"
            rowKey="id"
            loading={r.isFetching && r.isPlaceholderData}
            dataSource={r.data?.filas}
            scroll={{ x: 1120 }}
            rowClassName={() => 'fila-abre'}
            onRow={(t) => ({ onClick: () => ir({ to: '/plataforma/clientes/$id', params: { id: t.id } }) })}
            onChange={(p, _f, s) => {
              const sorter = s as SorterResult<ResumenTenant>
              const campo = sorter.order ? (sorter.columnKey as Orden) : undefined
              ir({
                search: (antes: BusquedaClientes) => ({
                  ...antes,
                  orden: campo,
                  dir: campo ? (sorter.order === 'ascend' ? 'asc' : 'desc') : undefined,
                  pagina: p.current === 1 ? undefined : p.current,
                  porPagina: p.pageSize === 50 ? undefined : p.pageSize,
                }),
                replace: true,
              })
            }}
            pagination={{ total: r.data?.total, current: b.pagina ?? 1, pageSize: b.porPagina ?? 50, showSizeChanger: true, pageSizeOptions: [25, 50, 100, 200] }}
            columns={[
              { title: 'Cliente', key: 'nombre', sorter: true, sortOrder: ordenDe('nombre'), fixed: 'left', width: 210, render: (_, t) => <div className="fila-nombre"><b>{t.nombre}</b><small className="mono">{t.id}</small></div> },
              { title: 'Estado', key: 'estado', sorter: true, sortOrder: ordenDe('estado'), render: (_, t) => <EstadoTenantTag estado={t.estado} /> },
              { title: 'Plan', key: 'plan', render: (_, t) => PLANES[t.plan].nombre },
              { title: 'Activos / usuarios', key: 'usuarios', sorter: true, sortOrder: ordenDe('usuarios'), align: 'right', width: 150, render: (_, t) => <span title="Activos: entraron en los últimos 30 días">{cifra(t.usuarios.activos30d)} <span className="tenue">/ {cifra(t.usuarios.total)}</span></span> },
              { title: 'Último ingreso', key: 'ultimoLogin', sorter: true, sortOrder: ordenDe('ultimoLogin'), width: 122, render: (_, t) => <Hace iso={t.ultimoLogin} /> },
              { title: 'Creado', key: 'creado', sorter: true, sortOrder: ordenDe('creado'), width: 100, render: (_, t) => fecha(t.creado) },
              { title: 'Uso del plan', key: 'uso', sorter: true, sortOrder: ordenDe('uso'), width: 140, render: (_, t) => <span title={t.usos.map((u) => `${u.nombre}: ${Math.round(u.fraccion * 100)} %`).join('\n')}><Medidor fraccion={t.usoMaximo} ancho={60} /></span> },
              { title: 'Pago', key: 'pago', render: (_, t) => <PagoTag estado={t.estadoPago} /> },
              { title: 'MRR', key: 'mrr', sorter: true, sortOrder: ordenDe('mrr'), align: 'right', render: (_, t) => (t.mrr ? plata(t.mrr) : <span className="tenue">—</span>) },
              { title: 'Salud', key: 'salud', sorter: true, sortOrder: ordenDe('salud'), render: (_, t) => <SaludTag salud={t.salud} /> },
              { title: 'Alertas', key: 'alertas', align: 'right', render: (_, t) => (t.alertas.length ? <b>{t.alertas.length}</b> : <span className="tenue">0</span>) },
            ]}
          />
        </div>
      )}
    </>
  )
}
