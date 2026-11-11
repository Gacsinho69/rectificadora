// Todas las alertas, de la más grave a la más leve. Se calculan al pedirlas: desaparecen solas al resolverse.
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Segmented, Select, Table } from 'antd'
import { api } from '../../../pantallas/api'
import { Cargando, PrioridadTag, Problema } from '../../../pantallas/componentes'
import { Encabezado } from '../../../pantallas/Marco'
import { ORDEN_PRIORIDAD, type Prioridad, PRIORIDADES, TIPOS_ALERTA, type TipoAlerta } from '../../alertas/reglas'
import type { Alerta } from './tipos'

const ruta = getRouteApi('/plataforma/alertas')

export function Alertas() {
  const b = ruta.useSearch()
  const ir = useNavigate({ from: '/plataforma/alertas' })
  const r = useQuery({ queryKey: ['alertas'], queryFn: () => api<{ alertas: Alerta[] }>('GET', '/plataforma/alertas') })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const todas = r.data.alertas
  const cuenta = (p: Prioridad) => todas.filter((a) => a.prioridad === p).length
  const filas = todas.filter((a) => (!b.prioridad || a.prioridad === b.prioridad) && (!b.tipo || a.tipo === b.tipo))
  return (
    <>
      <Encabezado titulo="Alertas" sub={`${todas.length} abiertas · se calculan con los datos de ahora`} />
      <div className="filtros">
        <Segmented
          value={b.prioridad ?? 'todas'}
          onChange={(v) => ir({ search: { ...b, prioridad: v === 'todas' ? undefined : String(v) }, replace: true })}
          options={[{ value: 'todas', label: `Todas (${todas.length})` }, ...(Object.keys(PRIORIDADES) as Prioridad[]).map((p) => ({ value: p, label: `${PRIORIDADES[p]} (${cuenta(p)})` }))]}
        />
        <Select
          allowClear
          placeholder="Tipo de alerta"
          style={{ minWidth: 220 }}
          value={b.tipo}
          onChange={(v) => ir({ search: { ...b, tipo: v }, replace: true })}
          options={(Object.keys(TIPOS_ALERTA) as TipoAlerta[]).map((t) => ({ value: t, label: `${TIPOS_ALERTA[t]} (${todas.filter((a) => a.tipo === t).length})` }))}
        />
      </div>
      <div className="bloque">
        <Table<Alerta>
          size="small"
          rowKey="id"
          dataSource={filas}
          pagination={filas.length > 100 ? { pageSize: 100 } : false}
          scroll={{ x: 760 }}
          locale={{ emptyText: 'Sin alertas con estos filtros.' }}
          columns={[
            { title: 'Prioridad', dataIndex: 'prioridad', width: 96, render: (p: Prioridad) => <PrioridadTag prioridad={p} />, sorter: (a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] },
            { title: 'Tipo', dataIndex: 'tipo', render: (t: TipoAlerta) => TIPOS_ALERTA[t] },
            { title: 'Cliente', key: 'c', render: (_, a) => (a.tenantId ? <Link to="/plataforma/clientes/$id" params={{ id: a.tenantId }}>{a.tenantNombre}</Link> : <span className="tenue">Plataforma</span>) },
            { title: 'Alerta', dataIndex: 'titulo', render: (v: string) => <b>{v}</b> },
            { title: 'Detalle', dataIndex: 'detalle', render: (v: string) => <span className="detalle">{v}</span> },
          ]}
        />
      </div>
    </>
  )
}
