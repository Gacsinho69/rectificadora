// Las cotizaciones del taller, de la más nueva a la más antigua.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Button, Input, Select, Table } from 'antd'
import { api, consulta } from '../../../pantallas/api'
import { Problema } from '../../../pantallas/componentes'
import { cifra, fecha, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { ESTADOS_COTIZACION } from '../../comercial/reglas'
import { EstadoCotTag, folioCot, folioOt, usePersona, usePortal } from './comun'
import type { FilaCotizacion } from './tipos'

const ruta = getRouteApi('/c/$portal/cotizaciones')

export function Cotizaciones() {
  const b = ruta.useSearch()
  const portal = usePortal()
  const { gestiona } = usePersona()
  const ir = useNavigate({ from: '/c/$portal/cotizaciones' })
  const r = useQuery({ queryKey: ['taller', 'cotizaciones', b], queryFn: () => api<{ total: number; filas: FilaCotizacion[] }>('GET', `/servicio/cotizaciones${consulta(b)}`), placeholderData: keepPreviousData })
  return (
    <>
      <Encabezado
        titulo="Cotizaciones"
        sub={r.data ? `${cifra(r.data.total)} cotizaciones` : undefined}
        acciones={gestiona ? <Button type="primary" onClick={() => ir({ to: '/c/$portal/cotizaciones/$id', params: { portal, id: 'nueva' } })}>Nueva cotización</Button> : null}
      />
      <div className="filtros">
        <Input.Search className="buscar" placeholder="Folio, cliente o motor" defaultValue={b.q} allowClear onSearch={(q) => ir({ search: { ...b, q: q || undefined, pagina: undefined }, replace: true })} />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="Estado"
          style={{ minWidth: 220 }}
          value={b.estado ? b.estado.split(',') : []}
          options={Object.entries(ESTADOS_COTIZACION).map(([value, label]) => ({ value, label }))}
          onChange={(v) => ir({ search: { ...b, estado: v.length ? v.join(',') : undefined, pagina: undefined }, replace: true })}
        />
      </div>
      {r.isError && <Problema error={r.error} />}
      <div className="bloque">
        <Table<FilaCotizacion>
          size="small"
          rowKey="id"
          loading={r.isFetching}
          dataSource={r.data?.filas}
          scroll={{ x: 820 }}
          rowClassName={() => 'fila-abre'}
          onRow={(q) => ({ onClick: () => ir({ to: '/c/$portal/cotizaciones/$id', params: { portal, id: q.id } }) })}
          pagination={{ total: r.data?.total, current: b.pagina ?? 1, pageSize: 50, showSizeChanger: false, onChange: (p) => ir({ search: { ...b, pagina: p === 1 ? undefined : p }, replace: true }) }}
          columns={[
            { title: 'Cotización', dataIndex: 'numero', width: 110, render: (v: number) => <b>{folioCot(v)}</b> },
            { title: 'Cliente', dataIndex: 'cliente' },
            { title: 'Motor', dataIndex: 'motor' },
            { title: 'OT', dataIndex: 'ot', render: (v: number | null) => (v ? folioOt(v) : <span className="tenue">—</span>) },
            { title: 'Estado', dataIndex: 'estado', render: (v) => <EstadoCotTag estado={v} /> },
            { title: 'Total', dataIndex: 'total', align: 'right', render: (v: number) => plata(v) },
            { title: 'Enviada', dataIndex: 'enviada', render: (v: string | null, q) => fecha(v ?? q.creada) },
          ]}
        />
      </div>
    </>
  )
}
