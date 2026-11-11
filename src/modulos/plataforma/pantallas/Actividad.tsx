// Ingresos y actividad de toda la plataforma: adopción, abandono, problemas de acceso y posibles ataques.
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Input, Segmented, Table, Tooltip } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Barras, Bloque, Cargando, Cifras, EstadoTenantTag, EstadoUsuarioTag, Hace, Problema, TablaEventos } from '../../../pantallas/componentes'
import { cifra, fecha, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { useYo } from '../../../pantallas/sesion'
import type { AdminPlataforma } from '../../acceso/identidad'
import { PLANES, type EstadoTenant, type Plan } from '../../tenants/reglas'
import { ROLES_TENANT, type EstadoUsuario, type RolTenant } from '../../usuarios/reglas'
import type { Dia, EventoVisible } from './tipos'

const ruta = getRouteApi('/plataforma/actividad')

type RespuestaActividad = {
  completo: boolean
  dias: number
  logins: { d1: number; d7: number; d30: number; fallidos24h: number; fallidos7d: number; fallidos30d: number }
  porDia: Dia[]
  tenantsInactivos: { id: string; nombre: string; estado: EstadoTenant; plan: Plan; mrr: number; usuarios: number; ultimoLogin: string | null; diasSinLogin: number | null }[]
  usuariosInactivos: { total: number; lista: { id: string; nombre: string; correo: string; rol: RolTenant; tenantId: string; tenantNombre: string; ultimoLogin: string | null; creado: string }[] }
  anomalias: { tipo: 'cuenta' | 'ip'; clave: string | null; tenantId: string | null; tenantNombre: string | null; fallidos: number; ultimo: string; detalle: string }[]
  fallidosRecientes: EventoVisible[]
}
type Persona = { id: string; nombre: string; correo: string; rol: RolTenant; estado: EstadoUsuario; mfa: boolean; tenantId: string; tenantNombre: string; ultimoLogin: string | null; creado: string }

const EnlaceCliente = (id: string | null, nombre: string | null) => (id ? <Link to="/plataforma/clientes/$id" params={{ id }}>{nombre}</Link> : <span>{nombre ?? '—'}</span>)

export function Actividad() {
  const { dias = 14 } = ruta.useSearch()
  const ir = useNavigate({ from: '/plataforma/actividad' })
  const yo = useYo()
  const puedeVer = yo.data?.actor?.tipo === 'plataforma' && (yo.data.actor as AdminPlataforma).permisos.includes('data.sensitive')
  const [completo, setCompleto] = useState(false)
  const r = useQuery({ queryKey: ['actividad', dias, completo], queryFn: () => api<RespuestaActividad>('GET', `/plataforma/actividad?dias=${dias}${completo ? '&completo=1' : ''}`) })
  const [q, setQ] = useState('')
  const busqueda = useQuery({ queryKey: ['personas', q], queryFn: () => api<Persona[]>('GET', `/plataforma/usuarios?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const a = r.data
  const verIps = puedeVer ? (
    <Tooltip title="Queda registrado en la auditoría">
      <button type="button" className="enlace" onClick={() => setCompleto(!completo)}>{completo ? 'Ocultar IPs' : 'Ver IPs completas'}</button>
    </Tooltip>
  ) : null
  return (
    <>
      <Encabezado titulo="Ingresos y actividad" sub="Todos los clientes" />
      <Cifras
        cifras={[
          { rotulo: 'Ingresos 24 h', valor: cifra(a.logins.d1) },
          { rotulo: 'Ingresos 7 días', valor: cifra(a.logins.d7) },
          { rotulo: 'Ingresos 30 días', valor: cifra(a.logins.d30) },
          { rotulo: 'Fallidos 24 h', valor: cifra(a.logins.fallidos24h), tono: a.anomalias.length ? 'rojo' : undefined },
          { rotulo: 'Fallidos 7 días', valor: cifra(a.logins.fallidos7d) },
          { rotulo: 'Fallidos 30 días', valor: cifra(a.logins.fallidos30d) },
        ]}
      />
      <Bloque titulo="Ingresos por día · 30 días">
        <Barras nombre="Ingresos" datos={a.porDia.map((d) => ({ etiqueta: fecha(`${d.dia}T12:00:00Z`), valor: d.logins, detalle: `${fecha(`${d.dia}T12:00:00Z`)} · ${d.usuarios} usuarios distintos` }))} />
      </Bloque>
      <Bloque titulo={`Actividad anómala · 24 h (${a.anomalias.length})`} extra={verIps}>
        <Table
          size="small"
          rowKey={(x) => `${x.tipo}:${x.clave}:${x.tenantId}`}
          pagination={false}
          dataSource={a.anomalias}
          scroll={{ x: 640 }}
          locale={{ emptyText: 'Sin ráfagas de ingresos fallidos.' }}
          columns={[
            { title: 'Qué', dataIndex: 'tipo', render: (t: string) => (t === 'ip' ? 'Muchos intentos desde una IP' : 'Muchos intentos contra una cuenta') },
            { title: 'Cuenta o IP', dataIndex: 'clave', render: (v: string | null) => <span className="mono">{v}</span> },
            { title: 'Cliente', key: 'c', render: (_, x) => EnlaceCliente(x.tenantId, x.tenantNombre) },
            { title: 'Detalle', dataIndex: 'detalle' },
            { title: 'Último', dataIndex: 'ultimo', render: (v: string) => <Hace iso={v} /> },
          ]}
        />
      </Bloque>
      <Bloque
        titulo={`Clientes sin actividad (${a.tenantsInactivos.length})`}
        extra={
          <Segmented
            size="small"
            value={dias}
            onChange={(v) => ir({ search: { dias: v === 14 ? undefined : Number(v) }, replace: true })}
            options={[7, 14, 30, 60].map((d) => ({ value: d, label: `${d} días` }))}
          />
        }
      >
        <Table
          size="small"
          rowKey="id"
          pagination={a.tenantsInactivos.length > 15 ? { pageSize: 15 } : false}
          dataSource={a.tenantsInactivos}
          scroll={{ x: 640 }}
          locale={{ emptyText: `Todos los clientes tuvieron ingresos en los últimos ${dias} días.` }}
          columns={[
            { title: 'Cliente', key: 'n', render: (_, t) => EnlaceCliente(t.id, t.nombre) },
            { title: 'Estado', dataIndex: 'estado', render: (v: EstadoTenant) => <EstadoTenantTag estado={v} /> },
            { title: 'Plan', dataIndex: 'plan', render: (v: Plan) => PLANES[v].nombre },
            { title: 'MRR', dataIndex: 'mrr', align: 'right', render: (v: number) => (v ? plata(v) : '—') },
            { title: 'Usuarios', dataIndex: 'usuarios', align: 'right' },
            { title: 'Último ingreso', dataIndex: 'ultimoLogin', render: (v: string | null) => <Hace iso={v} /> },
          ]}
        />
      </Bloque>
      <div className="columnas">
        <Bloque titulo={`Usuarios sin actividad hace 30 días (${cifra(a.usuariosInactivos.total)})`} extra={a.usuariosInactivos.total > a.usuariosInactivos.lista.length ? <span>Los {a.usuariosInactivos.lista.length} más antiguos</span> : null}>
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 10, size: 'small' }}
            dataSource={a.usuariosInactivos.lista}
            columns={[
              { title: 'Usuario', key: 'n', render: (_, u) => <div className="fila-nombre"><b>{u.nombre}</b><small>{u.correo}</small></div> },
              { title: 'Cliente', key: 'c', render: (_, u) => EnlaceCliente(u.tenantId, u.tenantNombre) },
              { title: 'Último ingreso', dataIndex: 'ultimoLogin', render: (v: string | null) => <Hace iso={v} /> },
            ]}
          />
        </Bloque>
        <Bloque titulo="Último ingreso por usuario" extra={<Input.Search size="small" placeholder="Nombre o correo" allowClear onSearch={setQ} style={{ width: 220 }} />}>
          {busqueda.isError && <Problema error={busqueda.error} />}
          {q.trim().length < 2 ? (
            <p className="tenue">Busca a una persona en todos los clientes.</p>
          ) : (
            <div style={{ margin: '-12px -14px' }}>
              <Table
                size="small"
                rowKey="id"
                loading={busqueda.isFetching}
                pagination={false}
                dataSource={busqueda.data}
                locale={{ emptyText: 'Nadie con ese nombre o correo.' }}
                columns={[
                  { title: 'Usuario', key: 'n', render: (_, u) => <div className="fila-nombre"><b>{u.nombre}</b><small>{u.correo} · {ROLES_TENANT[u.rol]}</small></div> },
                  { title: 'Cliente', key: 'c', render: (_, u) => EnlaceCliente(u.tenantId, u.tenantNombre) },
                  { title: 'Estado', dataIndex: 'estado', render: (v: EstadoUsuario) => <EstadoUsuarioTag estado={v} /> },
                  { title: 'Último ingreso', dataIndex: 'ultimoLogin', render: (v: string | null) => <Hace iso={v} /> },
                ]}
              />
            </div>
          )}
        </Bloque>
      </div>
      <Bloque titulo="Ingresos fallidos recientes" extra={verIps}>
        <TablaEventos filas={a.fallidosRecientes} conCliente={(e) => EnlaceCliente(e.tenantId, e.tenantNombre)} />
      </Bloque>
    </>
  )
}
