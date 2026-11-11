// La ficha de un cliente: su estado, sus alertas y siete pestañas. Cada pestaña pide lo suyo recién al abrirla.
import { DownOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Button, Dropdown, Switch, Table, Tabs, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, EstadoTenantTag, Hace, PagoTag, Problema, SaludTag, TablaEventos } from '../../../pantallas/componentes'
import { cifra, fecha, fechaHora, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import type { PestanaCliente } from '../../../pantallas/rutas'
import { useYo } from '../../../pantallas/sesion'
import type { AdminPlataforma } from '../../acceso/identidad'
import { PERMISOS_PLATAFORMA, type PermisoPlataforma } from '../../acceso/permisos'
import { ESTADOS_SALUD } from '../../salud/reglas'
import { FUNCIONES, type Funcion, PLANES, REGIONES } from '../../tenants/reglas'
import { type Dialogo, Acciones } from './Acciones'
import { ListaAlertas } from './Resumen'
import type { ActividadTenant, DetalleTenant, FacturacionTenant, Integraciones, SeguridadTenant, UsoTenant, UsuarioVisible } from './tipos'
import { ActividadPorPeriodo, CifrasUsuarios, TablaLimites, TablaUsuarios, VistaAuditoria, VistaFacturacion, VistaIntegraciones, VistaSeguridad, VistaUso } from './vistas'

const ruta = getRouteApi('/plataforma/clientes/$id')

export function Cliente() {
  const { id } = ruta.useParams()
  const { pestana = 'general' } = ruta.useSearch()
  const ir = useNavigate({ from: '/plataforma/clientes/$id' })
  const yo = useYo()
  const admin = yo.data?.actor?.tipo === 'plataforma' ? (yo.data.actor as AdminPlataforma) : null
  const puede = (p: PermisoPlataforma) => Boolean(admin?.permisos.includes(p))
  const [dialogo, setDialogo] = useState<Dialogo | null>(null)
  const r = useQuery({ queryKey: ['tenant', id], queryFn: () => api<DetalleTenant>('GET', `/plataforma/tenants/${id}`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const t = r.data

  const sinPermiso = (p: PermisoPlataforma) => (puede(p) ? undefined : `Te falta el permiso «${PERMISOS_PLATAFORMA[p]}»`)
  const item = (key: Dialogo['tipo'], label: string, permiso: PermisoPlataforma, motivoNo?: string) => {
    const no = sinPermiso(permiso) ?? motivoNo
    return { key, disabled: Boolean(no), label: no ? <Tooltip title={no} placement="left"><span>{label}</span></Tooltip> : label }
  }
  const menu: MenuProps['items'] = [
    item('estado', t.estado === 'suspended' || t.estado === 'cancelled' ? 'Reactivar o cambiar estado…' : 'Suspender o cambiar estado…', 'tenants.status'),
    item('plan', 'Cambiar plan…', 'tenants.plan', t.estado === 'cancelled' ? 'El cliente está cancelado' : undefined),
    item('limites', 'Ajustar límites…', 'tenants.limits'),
    { type: 'divider' },
    item('impersonar', 'Abrir su sistema (entrar como administrador)…', 'support.impersonate', !t.accesoSoporte ? 'El cliente no permite el acceso de soporte' : t.estado === 'cancelled' ? 'El cliente está cancelado' : undefined),
  ]
  const accionesUsuario = (u: UsuarioVisible) => {
    const items: MenuProps['items'] = [
      u.estado !== 'invited' ? { key: 'bloqueo', label: u.estado === 'blocked' ? 'Desbloquear…' : 'Bloquear…', disabled: !puede('users.block') } : null,
      { key: 'rol', label: 'Cambiar rol…', disabled: !puede('users.roles') },
    ].filter(Boolean)
    return (
      <Dropdown trigger={['click']} menu={{ items, onClick: ({ key }) => setDialogo({ tipo: key as 'bloqueo' | 'rol', usuario: u }) }}>
        <Button size="small" type="text" icon={<DownOutlined />} aria-label={`Acciones para ${u.nombre}`} />
      </Dropdown>
    )
  }

  const pestanas: { key: PestanaCliente; label: string; children: React.ReactNode }[] = [
    { key: 'general', label: 'General', children: <General t={t} puede={puede} cambiarFuncion={(funcion, activa) => setDialogo({ tipo: 'funcion', funcion, activa })} /> },
    { key: 'usuarios', label: `Usuarios (${t.usuarios.total + t.usuarios.invitados})`, children: <Usuarios id={id} acciones={accionesUsuario} puedeVer={puede('data.sensitive')} /> },
    { key: 'actividad', label: 'Actividad', children: <Actividad id={id} /> },
    { key: 'uso', label: 'Uso', children: <PestanaUso id={id} ajustes={t.ajustes} /> },
    { key: 'facturacion', label: 'Facturación', children: <PestanaFacturacion id={id} /> },
    { key: 'seguridad', label: 'Seguridad', children: <PestanaSeguridad id={id} puedeVer={puede('data.sensitive')} /> },
    { key: 'auditoria', label: 'Auditoría', children: <VistaAuditoria ruta={`/plataforma/tenants/${id}/eventos`} clave={['tenant', id]} /> },
  ]

  return (
    <>
      <Encabezado
        miga={<Link to="/plataforma/clientes">Clientes</Link>}
        titulo={t.nombre}
        sub={
          <>
            <EstadoTenantTag estado={t.estado} />
            <span>{PLANES[t.plan].nombre}</span>
            <SaludTag salud={t.salud} />
            <span className="mono">{t.id}</span>
            <span>{t.dominio}</span>
            {puede('support.impersonate') && t.accesoSoporte && t.estado !== 'cancelled' && (
              <button type="button" className="enlace" onClick={() => setDialogo({ tipo: 'impersonar' })}>
                Abrir su sistema
              </button>
            )}
          </>
        }
        acciones={
          <Dropdown trigger={['click']} menu={{ items: menu, onClick: ({ key }) => setDialogo({ tipo: key } as Dialogo) }}>
            <Button type="primary">
              Acciones <DownOutlined />
            </Button>
          </Dropdown>
        }
      />
      {t.alertas.length > 0 && (
        <Bloque titulo={`Alertas (${t.alertas.length})`}>
          <div style={{ margin: '-12px -14px' }}>
            <ListaAlertas alertas={t.alertas} conCliente={false} />
          </div>
        </Bloque>
      )}
      <div className="bloque" style={{ padding: '4px 14px 0' }}>
        <Tabs activeKey={pestana} onChange={(k) => ir({ search: { pestana: k === 'general' ? undefined : (k as PestanaCliente) }, replace: true })} items={pestanas.map((p) => ({ key: p.key, label: p.label }))} />
      </div>
      {pestanas.find((p) => p.key === pestana)?.children}
      <Acciones tenant={t} dialogo={dialogo} cerrar={() => setDialogo(null)} />
    </>
  )
}

function General({ t, puede, cambiarFuncion }: { t: DetalleTenant; puede: (p: PermisoPlataforma) => boolean; cambiarFuncion: (f: Funcion, activa: boolean) => void }) {
  return (
    <>
      <Cifras
        cifras={[
          { rotulo: 'Usuarios', valor: cifra(t.usuarios.total), nota: `${t.usuarios.invitados} invitaciones pendientes` },
          { rotulo: 'Activos 7 / 30 días', valor: `${cifra(t.usuarios.activos7d)} / ${cifra(t.usuarios.activos30d)}` },
          { rotulo: 'Último ingreso', valor: <Hace iso={t.ultimoLogin} /> },
          { rotulo: 'Ingresos 7 días', valor: cifra(t.logins7d), nota: `${t.fallidos24h} fallidos en 24 h` },
          { rotulo: 'MRR', valor: plata(t.mrr), nota: <PagoTag estado={t.estadoPago} /> },
          { rotulo: t.estado === 'trial' ? 'Fin de la prueba' : 'Próximo cobro', valor: fecha(t.estado === 'trial' ? t.trialVence : t.proximoCobro) },
        ]}
      />
      <div className="columnas">
        <Bloque titulo="Información general">
          <dl className="ficha">
            <dt>ID interno</dt>
            <dd className="mono">{t.id}</dd>
            <dt>Su sistema</dt>
            <dd>
              {t.dominio} <span className="tenue">(en desarrollo: /c/{t.slug})</span>
            </dd>
            <dt>Dominio propio</dt>
            <dd>{t.dominioPropio ?? <span className="tenue">—</span>}</dd>
            <dt>Región</dt>
            <dd>{REGIONES[t.region]}</dd>
            <dt>Creado</dt>
            <dd>{fecha(t.creado)}</dd>
            <dt>Facturación</dt>
            <dd>{t.correoFacturacion}</dd>
            <dt>MFA obligatorio</dt>
            <dd>{t.mfaObligatorio ? 'Sí' : 'No'}</dd>
            <dt>Acceso de soporte</dt>
            <dd>{t.accesoSoporte ? 'Permitido por el cliente' : 'No permitido: no se puede impersonar'}</dd>
            <dt>Administradores</dt>
            <dd>{t.administradores.map((a) => a.nombre).join(', ') || '—'}</dd>
          </dl>
        </Bloque>
        <Bloque titulo="Salud" extra={t.salud ? <SaludTag salud={t.salud} /> : null}>
          {t.salud ? (
            <div style={{ margin: '-12px -14px' }}>
              <Table
                size="small"
                rowKey="clave"
                pagination={false}
                dataSource={t.salud.factores}
                columns={[
                  { title: 'Factor', dataIndex: 'nombre' },
                  { title: 'Detalle', dataIndex: 'detalle', render: (v: string) => <span className="detalle">{v}</span> },
                  { title: 'Puntos', key: 'p', align: 'right', render: (_, f) => <b>{f.puntos}<span className="tenue">/{f.maximo}</span></b> },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={2}>{ESTADOS_SALUD[t.salud!.estado]}</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right"><b>{t.salud!.puntaje}/100</b></Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </div>
          ) : (
            <p className="tenue">Cliente cancelado: no se calcula.</p>
          )}
        </Bloque>
      </div>
      <div className="columnas">
        <Bloque titulo="Límites contratados · uso de este mes">
          <div style={{ margin: '-12px -14px' }}>
            <TablaLimites usos={t.usos} ajustados={t.ajustes} />
          </div>
        </Bloque>
        <Bloque titulo="Funciones activas" extra={puede('tenants.flags') ? null : <span>Solo lectura</span>}>
          <div style={{ margin: '-12px -14px' }}>
            <Table
              size="small"
              rowKey="clave"
              pagination={false}
              dataSource={(Object.keys(FUNCIONES) as Funcion[]).map((clave) => ({ clave, nombre: FUNCIONES[clave], activa: t.funciones[clave] }))}
              columns={[
                { title: 'Función', dataIndex: 'nombre' },
                { title: '', key: 's', align: 'right', render: (_, f) => <Switch size="small" checked={f.activa} disabled={!puede('tenants.flags')} onChange={(v) => cambiarFuncion(f.clave, v)} aria-label={f.nombre} /> },
              ]}
            />
          </div>
        </Bloque>
      </div>
      <Bloque titulo="Accesos de soporte recientes">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={t.impersonaciones}
          scroll={{ x: 700 }}
          locale={{ emptyText: 'Nadie del equipo ha entrado como un usuario de este cliente.' }}
          columns={[
            { title: 'Inicio', dataIndex: 'inicio', render: (v: string) => fechaHora(v) },
            { title: 'Fin', dataIndex: 'fin', render: (v: string | null, i) => (v ? fechaHora(v) : Date.parse(i.vence) < Date.now() ? `Venció ${fechaHora(i.vence)}` : <b>En curso</b>) },
            { title: 'Del equipo', dataIndex: 'admin' },
            { title: 'Como', dataIndex: 'usuario' },
            { title: 'Motivo', dataIndex: 'motivo', render: (v: string) => <span className="detalle">{v}</span> },
          ]}
        />
      </Bloque>
    </>
  )
}

/** El botón para ver IPs completas: solo con permiso, y el servidor lo anota en la auditoría. */
function VerCompleto({ completo, puede, cambiar }: { completo: boolean; puede: boolean; cambiar: (v: boolean) => void }) {
  if (!puede) return <span title="Necesitas el permiso de datos sensibles">IPs ocultas</span>
  return completo ? (
    <button type="button" className="enlace" onClick={() => cambiar(false)}>Ocultar IPs</button>
  ) : (
    <Tooltip title="Queda registrado en la auditoría del cliente">
      <button type="button" className="enlace" onClick={() => cambiar(true)}>Ver IPs completas</button>
    </Tooltip>
  )
}

function Usuarios({ id, acciones, puedeVer }: { id: string; acciones: (u: UsuarioVisible) => React.ReactNode; puedeVer: boolean }) {
  const [completo, setCompleto] = useState(false)
  const r = useQuery({ queryKey: ['tenant', id, 'usuarios', completo], queryFn: () => api<{ usuarios: UsuarioVisible[] }>('GET', `/plataforma/tenants/${id}/usuarios${completo ? '?completo=1' : ''}`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  return (
    <>
      <CifrasUsuarios usuarios={r.data.usuarios} />
      <Bloque titulo="Usuarios" extra={<VerCompleto completo={completo} puede={puedeVer} cambiar={setCompleto} />}>
        <TablaUsuarios usuarios={r.data.usuarios} acciones={acciones} />
      </Bloque>
    </>
  )
}

function Actividad({ id }: { id: string }) {
  const r = useQuery({ queryKey: ['tenant', id, 'actividad'], queryFn: () => api<ActividadTenant>('GET', `/plataforma/tenants/${id}/actividad`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const a = r.data
  return (
    <>
      <ActividadPorPeriodo dias={a.porDia} />
      <div className="columnas">
        <Bloque titulo="Ingresos recientes">
          <TablaEventos filas={a.logins} compacta />
        </Bloque>
        <Bloque titulo="Ingresos fallidos">
          <TablaEventos filas={a.fallidos} compacta />
        </Bloque>
      </div>
      <Bloque titulo="Acciones importantes de usuarios y del equipo">
        <TablaEventos filas={a.acciones} />
      </Bloque>
      <div className="columnas">
        <Bloque titulo="Últimas operaciones">
          <TablaEventos filas={a.operaciones} compacta />
        </Bloque>
        <Bloque titulo={`Usuarios sin actividad hace 30 días (${a.sinActividad.length})`}>
          <Table
            size="small"
            rowKey="id"
            pagination={a.sinActividad.length > 10 ? { pageSize: 10, size: 'small' } : false}
            dataSource={a.sinActividad}
            locale={{ emptyText: 'Todos entraron en los últimos 30 días.' }}
            columns={[
              { title: 'Usuario', key: 'n', render: (_, u) => <div className="fila-nombre"><b>{u.nombre}</b><small>{u.correo}</small></div> },
              { title: 'Último ingreso', dataIndex: 'ultimoLogin', render: (v: string | null) => <Hace iso={v} /> },
            ]}
          />
        </Bloque>
      </div>
    </>
  )
}

function PestanaUso({ id, ajustes }: { id: string; ajustes: DetalleTenant['ajustes'] }) {
  const r = useQuery({ queryKey: ['tenant', id, 'uso'], queryFn: () => api<UsoTenant>('GET', `/plataforma/tenants/${id}/uso`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  return <VistaUso datos={r.data} ajustados={ajustes} />
}

function PestanaFacturacion({ id }: { id: string }) {
  const r = useQuery({ queryKey: ['tenant', id, 'facturacion'], queryFn: () => api<FacturacionTenant>('GET', `/plataforma/tenants/${id}/facturacion`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  return <VistaFacturacion datos={r.data} />
}

function PestanaSeguridad({ id, puedeVer }: { id: string; puedeVer: boolean }) {
  const [completo, setCompleto] = useState(false)
  const r = useQuery({ queryKey: ['tenant', id, 'seguridad', completo], queryFn: () => api<SeguridadTenant>('GET', `/plataforma/tenants/${id}/seguridad${completo ? '?completo=1' : ''}`) })
  const integraciones = useQuery({ queryKey: ['tenant', id, 'integraciones'], queryFn: () => api<Integraciones>('GET', `/plataforma/tenants/${id}/integraciones`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  return (
    <>
      <VistaSeguridad datos={r.data} verCompleto={<VerCompleto completo={completo} puede={puedeVer} cambiar={setCompleto} />} />
      {integraciones.data && <VistaIntegraciones datos={integraciones.data} />}
    </>
  )
}
