// El panel del administrador de un cliente: su gente, su plan, su facturación, su seguridad y su auditoría. Nada de
// otros clientes ni de lo interno de la plataforma: el servidor solo responde con lo de su organización.
import { DownOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Alert, App, Button, Dropdown, Form, Input, Modal, Select, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Hace, PagoTag, Problema, TablaEventos } from '../../../pantallas/componentes'
import { cifra, fecha, plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { PESTANAS_ORGANIZACION, type PestanaOrganizacion } from '../../../pantallas/rutas'
import { useYo } from '../../../pantallas/sesion'
import type { EstadoTenant } from '../../tenants/reglas'
import { ESTADOS_TENANT, FUNCIONES, type Funcion } from '../../tenants/reglas'
import { ROLES_TENANT, type RolTenant } from '../../usuarios/reglas'
import type { Dia, Factura, FacturacionTenant, Integraciones, PaginaEventos, SeguridadTenant, Uso, UsoTenant, UsuarioVisible } from '../../plataforma/pantallas/tipos'
import { ActividadPorPeriodo, CifrasUsuarios, TablaLimites, TablaUsuarios, VistaAuditoria, VistaFacturacion, VistaIntegraciones, VistaSeguridad, VistaUso } from '../../plataforma/pantallas/vistas'

const ruta = getRouteApi('/organizacion/')

type ResumenOrganizacion = {
  organizacion: { id: string; nombre: string; plan: string; nombrePlan: string; estado: EstadoTenant; dominio: string; dominioPropio: string | null; trialVence: string | null; funciones: Funcion[]; mfaObligatorio: boolean; accesoSoporte: boolean }
  usos: Uso[]
  usuarios: { total: number; activos30d: number; activos7d: number; invitados: number; bloqueados: number; administradores: number; conMfa: number }
  ultimosLogins: UsuarioVisible[]
  invitaciones: UsuarioVisible[]
  facturacion: { estado: FacturacionTenant['estadoPago']; montoMensual: number; proximoCobro: string | null; ultimaFactura: Factura | null }
  integraciones: { activas: number; fallando: number; clavesApi: number }
  fallidos24h: number
  porDia: Dia[]
}

export function Organizacion() {
  const { pestana = 'resumen' } = ruta.useSearch()
  const yo = useYo()
  const persona = yo.data?.actor?.tipo === 'tenant' ? yo.data.actor : yo.data?.impersonacion
  const contenido: Record<PestanaOrganizacion, React.ReactNode> = {
    resumen: <Resumen />,
    usuarios: <Usuarios yo={persona?.id} />,
    uso: <Consulta<UsoTenant> ruta="/organizacion/uso" vista={(d) => <VistaUso datos={d} />} />,
    facturacion: <Consulta<FacturacionTenant> ruta="/organizacion/facturacion" vista={(d) => <VistaFacturacion datos={d} />} />,
    integraciones: <Consulta<Integraciones> ruta="/organizacion/integraciones" vista={(d) => <VistaIntegraciones datos={d} />} />,
    seguridad: <Consulta<SeguridadTenant> ruta="/organizacion/seguridad" vista={(d) => <Seguridad datos={d} />} />,
    auditoria: <VistaAuditoria ruta="/organizacion/eventos" clave={['organizacion']} />,
  }
  return (
    <>
      <Encabezado titulo={PESTANAS_ORGANIZACION[pestana].texto} sub={persona ? persona.tenantNombre : undefined} />
      {persona?.estadoTenant === 'suspended' && <Alert type="warning" showIcon className="problema" title="Tu organización está suspendida" description="Puedes revisar todo, pero no hacer cambios. Revisa la facturación o escríbenos para reactivarla." />}
      {contenido[pestana]}
    </>
  )
}

function Consulta<T>({ ruta, vista }: { ruta: string; vista: (d: T) => React.ReactNode }) {
  const r = useQuery({ queryKey: ['organizacion', ruta], queryFn: () => api<T>('GET', ruta) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  return vista(r.data)
}

function Resumen() {
  const ir = useNavigate({ from: '/organizacion/' })
  const a = (pestana: PestanaOrganizacion) => () => ir({ search: { pestana } })
  const auditoria = useQuery({ queryKey: ['organizacion', 'auditoria-reciente'], queryFn: () => api<PaginaEventos>('GET', '/organizacion/eventos?categoria=usuarios,seguridad,soporte,configuracion,datos&porPagina=10') })
  return (
    <Consulta<ResumenOrganizacion>
      ruta="/organizacion/resumen"
      vista={(d) => (
        <>
          <Cifras
            cifras={[
              { rotulo: 'Usuarios', valor: cifra(d.usuarios.total), nota: `${d.usuarios.administradores} administradores`, enlace: a('usuarios') },
              { rotulo: 'Activos 30 días', valor: cifra(d.usuarios.activos30d), nota: `${d.usuarios.activos7d} esta semana` },
              { rotulo: 'Invitaciones pendientes', valor: cifra(d.usuarios.invitados), enlace: a('usuarios') },
              { rotulo: 'Plan', valor: d.organizacion.nombrePlan, nota: d.organizacion.estado === 'trial' ? `Prueba hasta el ${fecha(d.organizacion.trialVence)}` : ESTADOS_TENANT[d.organizacion.estado], enlace: a('uso') },
              { rotulo: 'Pago', valor: <PagoTag estado={d.facturacion.estado} />, nota: d.facturacion.proximoCobro ? `Próximo cobro ${fecha(d.facturacion.proximoCobro)} · ${plata(d.facturacion.montoMensual)}` : undefined, enlace: a('facturacion') },
              { rotulo: 'Ingresos fallidos 24 h', valor: cifra(d.fallidos24h), nota: `${d.usuarios.conMfa} de ${d.usuarios.total} usuarios con MFA`, tono: d.fallidos24h >= 10 ? 'rojo' : undefined, enlace: a('seguridad') },
            ]}
          />
          <div className="columnas">
            <Bloque titulo="Uso del plan · este mes" extra={<button type="button" className="enlace" onClick={a('uso')}>Ver el detalle</button>}>
              <div style={{ margin: '-12px -14px' }}>
                <TablaLimites usos={d.usos} />
              </div>
            </Bloque>
            <Bloque titulo="Últimos ingresos" extra={<button type="button" className="enlace" onClick={a('usuarios')}>Todos los usuarios</button>}>
              <div style={{ margin: '-12px -14px' }}>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={d.ultimosLogins}
                  columns={[
                    { title: 'Usuario', key: 'n', render: (_, u) => <div className="fila-nombre"><b>{u.nombre}</b><small>{ROLES_TENANT[u.rol]}</small></div> },
                    { title: 'Último ingreso', dataIndex: 'ultimoLogin', render: (v: string | null) => <Hace iso={v} /> },
                  ]}
                />
              </div>
            </Bloque>
          </div>
          <div className="columnas">
            <Bloque titulo={`Invitaciones pendientes (${d.invitaciones.length})`}>
              {d.invitaciones.length ? (
                <div style={{ margin: '-12px -14px' }}>
                  <Table size="small" rowKey="id" pagination={false} dataSource={d.invitaciones} columns={[{ title: 'Invitado', key: 'n', render: (_, u) => <div className="fila-nombre"><b>{u.nombre}</b><small>{u.correo}</small></div> }, { title: 'Rol', dataIndex: 'rol', render: (v: RolTenant) => ROLES_TENANT[v] }, { title: 'Enviada', dataIndex: 'invitado', render: (v: string | null) => fecha(v) }]} />
                </div>
              ) : (
                <p className="tenue">No hay invitaciones esperando respuesta.</p>
              )}
            </Bloque>
            <Bloque titulo="Integraciones y funciones" extra={<button type="button" className="enlace" onClick={a('integraciones')}>Ver integraciones</button>}>
              <dl className="ficha">
                <dt>Integraciones</dt>
                <dd>
                  {d.integraciones.activas} funcionando{d.integraciones.fallando ? <b style={{ color: 'var(--rojo)' }}> · {d.integraciones.fallando} fallando</b> : null}
                </dd>
                <dt>Claves de API activas</dt>
                <dd>{d.integraciones.clavesApi}</dd>
                <dt>Funciones del plan</dt>
                <dd>{d.organizacion.funciones.map((f) => FUNCIONES[f]).join(', ') || '—'}</dd>
                <dt>Dirección</dt>
                <dd>{d.organizacion.dominioPropio ?? d.organizacion.dominio}</dd>
                <dt>Acceso de soporte</dt>
                <dd>{d.organizacion.accesoSoporte ? 'Permitido: el equipo de la plataforma puede entrar como administrador, con motivo y registro' : 'No permitido'}</dd>
              </dl>
            </Bloque>
          </div>
          <ActividadPorPeriodo dias={d.porDia} />
          <Bloque titulo="Auditoría reciente" extra={<button type="button" className="enlace" onClick={a('auditoria')}>Ver toda la auditoría</button>}>
            {auditoria.isError ? <Problema error={auditoria.error} /> : <TablaEventos filas={auditoria.data?.filas ?? []} cargando={auditoria.isPending} compacta />}
          </Bloque>
        </>
      )}
    />
  )
}

function Usuarios({ yo }: { yo?: string }) {
  const r = useQuery({ queryKey: ['organizacion', 'usuarios'], queryFn: () => api<UsuarioVisible[]>('GET', '/organizacion/usuarios') })
  const [dialogo, setDialogo] = useState<{ tipo: 'bloqueo' | 'rol'; usuario: UsuarioVisible } | null>(null)
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  return (
    <>
      <CifrasUsuarios usuarios={r.data} />
      <Bloque titulo="Usuarios de la organización">
        <TablaUsuarios
          usuarios={r.data}
          acciones={(u) =>
            u.id === yo ? null : (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [u.estado !== 'invited' ? { key: 'bloqueo', label: u.estado === 'blocked' ? 'Desbloquear…' : 'Bloquear…' } : null, { key: 'rol', label: 'Cambiar rol…' }].filter(Boolean),
                  onClick: ({ key }) => setDialogo({ tipo: key as 'bloqueo' | 'rol', usuario: u }),
                }}
              >
                <Button size="small" type="text" icon={<DownOutlined />} aria-label={`Acciones para ${u.nombre}`} />
              </Dropdown>
            )
          }
        />
      </Bloque>
      {dialogo && <AccionUsuario {...dialogo} cerrar={() => setDialogo(null)} />}
    </>
  )
}

function AccionUsuario({ tipo, usuario, cerrar }: { tipo: 'bloqueo' | 'rol'; usuario: UsuarioVisible; cerrar: () => void }) {
  const [form] = Form.useForm<{ rol?: RolTenant; motivo?: string }>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const bloquear = usuario.estado !== 'blocked'
  const accion = useMutation({
    mutationFn: (v: { rol?: RolTenant; motivo?: string }) =>
      tipo === 'rol' ? api('POST', `/organizacion/usuarios/${usuario.id}/rol`, { rol: v.rol }) : api('POST', `/organizacion/usuarios/${usuario.id}/bloqueo`, { bloqueado: bloquear, motivo: v.motivo || undefined }),
    onSuccess: async () => {
      message.success(tipo === 'rol' ? 'Rol cambiado.' : bloquear ? 'Usuario bloqueado.' : 'Usuario desbloqueado.')
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['organizacion'] })
    },
  })
  return (
    <Modal
      open
      title={tipo === 'rol' ? `Cambiar el rol de ${usuario.nombre}` : `${bloquear ? 'Bloquear' : 'Desbloquear'} a ${usuario.nombre}`}
      okText={tipo === 'rol' ? 'Cambiar' : bloquear ? 'Bloquear' : 'Desbloquear'}
      okButtonProps={{ danger: tipo === 'bloqueo' && bloquear }}
      cancelText="Cancelar"
      confirmLoading={accion.isPending}
      onCancel={() => !accion.isPending && cerrar()}
      onOk={() => form.validateFields().then((v) => accion.mutate(v))}
      destroyOnHidden
    >
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" initialValues={{ rol: usuario.rol }}>
        {tipo === 'rol' ? (
          <Form.Item label="Rol" name="rol">
            <Select options={Object.entries(ROLES_TENANT).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        ) : (
          <>
            {bloquear && <p>No podrá entrar hasta que lo desbloquees.</p>}
            <Form.Item label="Motivo (opcional)" name="motivo">
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  )
}

function Seguridad({ datos }: { datos: SeguridadTenant }) {
  return (
    <>
      <VistaSeguridad datos={datos} />
      <Bloque titulo="Acceso del soporte de la plataforma">
        <p style={{ margin: 0 }}>
          {datos.accesoSoporte
            ? 'Permitido. Cada vez que alguien del equipo entra como un administrador de tu organización queda registrado aquí arriba, en «Eventos sensibles», con su nombre, el motivo, la hora de inicio y de fin.'
            : 'No permitido. Nadie del equipo de la plataforma puede entrar a tu organización.'}
        </p>
      </Bloque>
    </>
  )
}
