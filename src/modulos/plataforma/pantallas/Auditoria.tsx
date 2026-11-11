// La auditoría de toda la plataforma: cada evento con quién, a quién, cuándo, desde dónde y sus datos.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Button, DatePicker, Select } from 'antd'
import dayjs from 'dayjs'
import { api, consulta } from '../../../pantallas/api'
import { Problema, TablaEventos } from '../../../pantallas/componentes'
import { cifra } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import type { BusquedaAuditoria } from '../../../pantallas/rutas'
import { CATEGORIAS, type Categoria, TIPOS_DE_EVENTO, type TipoEvento } from '../../eventos/tipos'
import type { PaginaEventos } from './tipos'

const ruta = getRouteApi('/plataforma/auditoria')

export function Auditoria() {
  const b = ruta.useSearch()
  const ir = useNavigate({ from: '/plataforma/auditoria' })
  const cambiar = (cambios: Partial<BusquedaAuditoria>) => ir({ search: (antes: BusquedaAuditoria) => ({ ...antes, pagina: undefined, ...cambios }), replace: true })
  const opciones = useQuery({ queryKey: ['opciones'], queryFn: () => api<{ tenants: { id: string; nombre: string }[] }>('GET', '/plataforma/opciones'), staleTime: 300_000 })
  const r = useQuery({ queryKey: ['auditoria', b], queryFn: () => api<PaginaEventos>('GET', `/plataforma/eventos${consulta(b)}`), placeholderData: keepPreviousData })
  const categorias = b.categoria ? (b.categoria.split(',') as Categoria[]) : []
  const tipos = (Object.keys(TIPOS_DE_EVENTO) as TipoEvento[]).filter((t) => !categorias.length || categorias.includes(TIPOS_DE_EVENTO[t].categoria))
  const hayFiltros = Object.entries(b).some(([k, v]) => v !== undefined && k !== 'pagina' && k !== 'porPagina')
  return (
    <>
      <Encabezado titulo="Auditoría" sub={r.data ? `${cifra(r.data.total)} eventos${hayFiltros ? ' con estos filtros' : ''} · solo se agregan, nunca se editan ni se borran` : undefined} />
      <div className="filtros">
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="Categoría"
          style={{ minWidth: 200 }}
          value={categorias}
          options={Object.entries(CATEGORIAS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => cambiar({ categoria: v.join(',') || undefined, tipo: undefined })}
        />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Tipo de evento" style={{ minWidth: 240 }} value={b.tipo} options={tipos.map((t) => ({ value: t, label: TIPOS_DE_EVENTO[t].nombre }))} onChange={(v) => cambiar({ tipo: v })} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="Cliente" style={{ minWidth: 220 }} value={b.tenant} loading={opciones.isPending} options={opciones.data?.tenants.map((t) => ({ value: t.id, label: t.nombre }))} onChange={(v) => cambiar({ tenant: v })} />
        <Select allowClear placeholder="Severidad" value={b.severidad} options={[{ value: 'critical', label: 'Crítico' }, { value: 'error', label: 'Error' }, { value: 'warning', label: 'Aviso' }, { value: 'info', label: 'Información' }]} onChange={(v) => cambiar({ severidad: v })} />
        <DatePicker.RangePicker value={[b.desde ? dayjs(b.desde) : null, b.hasta ? dayjs(b.hasta) : null]} onChange={(v) => cambiar({ desde: v?.[0]?.format('YYYY-MM-DD'), hasta: v?.[1]?.format('YYYY-MM-DD') })} />
        {hayFiltros && (
          <Button type="link" onClick={() => ir({ search: {}, replace: true })}>
            Quitar filtros
          </Button>
        )}
      </div>
      {r.isError && <Problema error={r.error} />}
      <div className="bloque">
        <TablaEventos
          filas={r.data?.filas ?? []}
          cargando={r.isFetching}
          conCliente={(e) => (e.tenantId ? <Link to="/plataforma/clientes/$id" params={{ id: e.tenantId }}>{e.tenantNombre}</Link> : <span className="tenue">Plataforma</span>)}
          paginacion={{
            total: r.data?.total ?? 0,
            pagina: b.pagina ?? 1,
            porPagina: b.porPagina ?? 50,
            cambiar: (pagina, porPagina) => ir({ search: (antes: BusquedaAuditoria) => ({ ...antes, pagina: pagina === 1 ? undefined : pagina, porPagina: porPagina === 50 ? undefined : porPagina }), replace: true }),
          }}
        />
      </div>
    </>
  )
}
