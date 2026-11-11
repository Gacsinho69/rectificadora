// La primera pantalla del equipo: cómo está la plataforma, en un vistazo. Cada cifra lleva a la lista que la explica.
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Table } from 'antd'
import { api } from '../../../pantallas/api'
import { Barras, Bloque, Cargando, Cifras, Hace, PrioridadTag, Problema, resumenDeEvento, SaludTag, SeveridadTag } from '../../../pantallas/componentes'
import { cifra, fecha, fechaHora, plata, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { PLANES } from '../../tenants/reglas'
import type { Alerta, RespuestaResumen } from './tipos'

export function ListaAlertas({ alertas, conCliente = true }: { alertas: Alerta[]; conCliente?: boolean }) {
  if (!alertas.length) return <p className="tenue" style={{ padding: '10px 14px', margin: 0 }}>Sin alertas.</p>
  return (
    <ul className="lista-alertas">
      {alertas.map((a) => (
        <li key={a.id}>
          <PrioridadTag prioridad={a.prioridad} />
          <span className="titulo">
            {a.titulo}
            {conCliente && (
              <>
                {' · '}
                {a.tenantId ? (
                  <Link to="/plataforma/clientes/$id" params={{ id: a.tenantId }}>
                    {a.tenantNombre}
                  </Link>
                ) : (
                  <span className="tenue">Plataforma</span>
                )}
              </>
            )}
          </span>
          <span className="det">{a.detalle}</span>
        </li>
      ))}
    </ul>
  )
}

export function Resumen() {
  const r = useQuery({ queryKey: ['resumen'], queryFn: () => api<RespuestaResumen>('GET', '/plataforma/resumen') })
  const ir = useNavigate()
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const d = r.data
  const lista = (search: Record<string, string>) => () => ir({ to: '/plataforma/clientes', search })
  const urgentes = d.alertas.porPrioridad.critical + d.alertas.porPrioridad.high
  return (
    <>
      <Encabezado titulo="Resumen de la plataforma" sub={`${cifra(d.tenants.total)} clientes · actualizado ${fechaHora(new Date().toISOString())}`} />
      <Cifras
        cifras={[
          { rotulo: 'Clientes activos', valor: cifra(d.tenants.porEstado.active), nota: `${d.tenants.porEstado.past_due} con pago vencido`, enlace: lista({ estado: 'active,past_due' }) },
          { rotulo: 'En prueba', valor: cifra(d.tenants.porEstado.trial), enlace: lista({ estado: 'trial', orden: 'creado' }) },
          { rotulo: 'Suspendidos o cancelados', valor: cifra(d.tenants.porEstado.suspended + d.tenants.porEstado.cancelled), nota: `${plural(d.tenants.porEstado.suspended, 'suspendido')} · ${plural(d.tenants.porEstado.cancelled, 'cancelado')}`, enlace: lista({ estado: 'suspended,cancelled' }) },
          { rotulo: 'MRR', valor: plata(d.mrr.total), nota: `${d.mrr.clientesPagando} clientes pagando` },
          { rotulo: 'Pagos vencidos o fallidos', valor: cifra(d.pagos.vencidos + d.pagos.fallidos), nota: `${plata(d.mrr.enRiesgo)} de MRR en riesgo`, tono: d.pagos.fallidos ? 'rojo' : undefined, enlace: lista({ pago: 'past_due,failed', orden: 'mrr' }) },
          { rotulo: 'Alertas críticas y altas', valor: cifra(urgentes), nota: `${d.alertas.total} en total`, tono: d.alertas.porPrioridad.critical ? 'rojo' : undefined, enlace: () => ir({ to: '/plataforma/alertas' }) },
        ]}
      />
      <Cifras
        cifras={[
          { rotulo: 'Usuarios registrados', valor: cifra(d.usuarios.total) },
          { rotulo: 'Activos 24 h', valor: cifra(d.usuarios.activos24h) },
          { rotulo: 'Activos 7 días', valor: cifra(d.usuarios.activos7d) },
          { rotulo: 'Activos 30 días', valor: cifra(d.usuarios.activos30d) },
          { rotulo: 'Ingresos 24 h', valor: cifra(d.logins.d1), nota: `${cifra(d.logins.d7)} en 7 días`, enlace: () => ir({ to: '/plataforma/actividad' }) },
          { rotulo: 'Ingresos fallidos 24 h', valor: cifra(d.logins.fallidos24h), nota: `${cifra(d.logins.fallidos7d)} en 7 días`, tono: d.logins.fallidos24h > 50 ? 'naranjo' : undefined, enlace: () => ir({ to: '/plataforma/actividad' }) },
          { rotulo: 'Errores críticos 24 h', valor: cifra(d.logins.criticos24h), nota: `${cifra(d.logins.errores24h)} errores en total`, tono: d.logins.criticos24h ? 'rojo' : undefined, enlace: () => ir({ to: '/plataforma/auditoria', search: { categoria: 'sistema' } }) },
        ]}
      />
      <div className="columnas">
        <Bloque titulo="Alertas principales" extra={<Link to="/plataforma/alertas">Ver las {d.alertas.total}</Link>}>
          <div style={{ margin: '-12px -14px' }}>
            <ListaAlertas alertas={d.alertas.principales} />
          </div>
        </Bloque>
        <Bloque titulo="Clientes que necesitan atención" extra={<Link to="/plataforma/clientes" search={{ salud: 'critical,at_risk', orden: 'salud', dir: 'asc' }}>Ver todos</Link>}>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={d.atencion}
            rowClassName={() => 'fila-abre'}
            onRow={(t) => ({ onClick: () => ir({ to: '/plataforma/clientes/$id', params: { id: t.id } }) })}
            locale={{ emptyText: 'Ningún cliente en riesgo.' }}
            columns={[
              { title: 'Cliente', key: 'n', render: (_, t) => <div className="fila-nombre"><b>{t.nombre}</b><small>{PLANES[t.plan].nombre} · {plata(t.mrr)}/mes</small></div> },
              { title: 'Salud', key: 's', render: (_, t) => <SaludTag salud={t.salud} /> },
              { title: 'Motivo principal', dataIndex: 'motivo', render: (v: string | null) => v ?? <span className="tenue">Varios factores</span> },
              { title: 'Último ingreso', dataIndex: 'ultimoLogin', render: (v: string | null) => <Hace iso={v} /> },
            ]}
          />
        </Bloque>
      </div>
      <Bloque titulo="Ingresos por día · últimos 30 días" extra={<span>Inicios de sesión de todos los clientes</span>}>
        <Barras nombre="Ingresos" datos={d.porDia.map((x) => ({ etiqueta: fecha(`${x.dia}T12:00:00Z`), valor: x.logins, detalle: `${fecha(`${x.dia}T12:00:00Z`)} · ${x.usuarios} usuarios · ${x.fallidos} fallidos` }))} />
      </Bloque>
      <Bloque titulo="Errores recientes · 7 días" extra={<Link to="/plataforma/auditoria" search={{ categoria: 'sistema' }}>Ver todos</Link>}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={d.errores.recientes}
          scroll={{ x: 640 }}
          locale={{ emptyText: 'Sin errores en 7 días.' }}
          columns={[
            { title: 'Cuándo', dataIndex: 'createdAt', width: 130, render: (v: string) => fechaHora(v) },
            { title: 'Tipo', key: 't', render: (_, e) => <span className="evento-nombre">{e.nombre} <SeveridadTag severidad={e.severity} /></span> },
            { title: 'Cliente', key: 'c', render: (_, e) => (e.tenantId ? <Link to="/plataforma/clientes/$id" params={{ id: e.tenantId }}>{e.tenantNombre}</Link> : <span className="tenue">Plataforma</span>) },
            { title: 'Detalle', key: 'd', render: (_, e) => <span className="detalle">{resumenDeEvento(e)}</span> },
          ]}
        />
      </Bloque>
    </>
  )
}
