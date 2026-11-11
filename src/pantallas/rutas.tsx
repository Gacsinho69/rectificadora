// El mapa de la app: cada pantalla con su dirección. Los filtros de cada lista viajan en la dirección, así una vista
// filtrada se comparte con un enlace.
import { AlertOutlined, AuditOutlined, CreditCardOutlined, DashboardOutlined, ApiOutlined, LineChartOutlined, LockOutlined, PieChartOutlined, ShopOutlined, TeamOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Navigate, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { Button } from 'antd'
import type { Alerta } from '../modulos/alertas/reglas'
import { ROLES_TENANT } from '../modulos/usuarios/reglas'
import { api } from './api'
import { Cargando, Problema } from './componentes'
import { Entrar } from './Entrar'
import { hora } from './formato'
import { Marco } from './Marco'
import { useYo } from './sesion'

const Resumen = lazyRouteComponent(() => import('../modulos/plataforma/pantallas/Resumen'), 'Resumen')
const Clientes = lazyRouteComponent(() => import('../modulos/plataforma/pantallas/Clientes'), 'Clientes')
const Cliente = lazyRouteComponent(() => import('../modulos/plataforma/pantallas/Cliente'), 'Cliente')
const Alertas = lazyRouteComponent(() => import('../modulos/plataforma/pantallas/Alertas'), 'Alertas')
const Actividad = lazyRouteComponent(() => import('../modulos/plataforma/pantallas/Actividad'), 'Actividad')
const Auditoria = lazyRouteComponent(() => import('../modulos/plataforma/pantallas/Auditoria'), 'Auditoria')
const Organizacion = lazyRouteComponent(() => import('../modulos/organizacion/pantallas/Organizacion'), 'Organizacion')

const texto = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
const numero = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined)

/** Desde la raíz, cada uno a lo suyo: el equipo a la consola, el administrador del cliente a su panel. */
function Inicio() {
  const yo = useYo()
  if (yo.isPending) return <Cargando />
  if (yo.isError) return <Problema error={yo.error} />
  if (!yo.data.actor) return <Navigate to="/entrar" />
  return <Navigate to={yo.data.actor.tipo === 'plataforma' ? '/plataforma' : '/organizacion'} />
}

function MarcoPlataforma() {
  const yo = useYo()
  const ruta = useRouterState({ select: (s) => s.location.pathname })
  const alertas = useQuery({ queryKey: ['alertas'], queryFn: () => api<{ alertas: Alerta[] }>('GET', '/plataforma/alertas'), staleTime: 60_000, enabled: yo.data?.actor?.tipo === 'plataforma' })
  if (yo.isPending) return <Cargando />
  if (yo.isError) return <Problema error={yo.error} />
  const actor = yo.data.actor
  if (!actor) return <Navigate to="/entrar" />
  if (actor.tipo !== 'plataforma') return <Navigate to="/organizacion" />
  const urgentes = alertas.data?.alertas.filter((a) => a.prioridad === 'critical' || a.prioridad === 'high').length
  const en = (a: string) => (a === '/plataforma' ? ruta === '/plataforma' || ruta === '/plataforma/' : ruta.startsWith(a))
  return (
    <Marco
      titulo="Consola de la plataforma"
      subtitulo="Equipo interno · todos los clientes"
      persona={{ nombre: actor.nombre, detalle: actor.correo }}
      aviso={yo.data.impersonacion ? <AvisoImpersonacion /> : undefined}
      enlaces={[
        { a: '/plataforma', texto: 'Resumen', icono: <DashboardOutlined />, activo: en('/plataforma') },
        { a: '/plataforma/clientes', texto: 'Clientes', icono: <ShopOutlined />, activo: en('/plataforma/clientes') },
        { a: '/plataforma/alertas', texto: 'Alertas', icono: <AlertOutlined />, cuenta: urgentes, activo: en('/plataforma/alertas') },
        { a: '/plataforma/actividad', texto: 'Ingresos y actividad', icono: <LineChartOutlined />, activo: en('/plataforma/actividad') },
        { a: '/plataforma/auditoria', texto: 'Auditoría', icono: <AuditOutlined />, activo: en('/plataforma/auditoria') },
      ]}
    >
      <Outlet />
    </Marco>
  )
}

/** Alguien del equipo dentro del panel de un cliente: siempre a la vista, con el motivo, la hora de término y cómo salir. */
function AvisoImpersonacion() {
  const yo = useYo()
  const consultas = useQueryClient()
  const ir = useNavigate()
  const terminar = useMutation({
    mutationFn: () => api<{ tenantId: string | null }>('POST', '/plataforma/impersonacion/terminar', {}),
    // Primero se va a la consola y después se refresca la sesión: si fuera al revés, el panel del cliente vería que la
    // impersonación terminó y mandaría al resumen antes de llegar a la ficha.
    onSuccess: async (r) => {
      await (r.tenantId ? ir({ to: '/plataforma/clientes/$id', params: { id: r.tenantId }, search: { pestana: 'auditoria' } }) : ir({ to: '/plataforma' }))
      await consultas.invalidateQueries()
    },
  })
  const imp = yo.data?.impersonacion
  if (!imp?.impersonacion) return null
  return (
    <div className="impersonando" role="status">
      <span>
        Estás dentro de <b>{imp.tenantNombre}</b> como <b>{imp.nombre}</b> ({ROLES_TENANT[imp.rol].toLowerCase()}). Todo lo que hagas queda en su auditoría a tu nombre.
      </span>
      <span>Motivo: {imp.impersonacion.motivo}</span>
      <span>Termina sola a las {hora(imp.impersonacion.vence)}</span>
      <Button size="small" onClick={() => terminar.mutate()} loading={terminar.isPending}>
        Terminar y volver a la consola
      </Button>
    </div>
  )
}

export const PESTANAS_ORGANIZACION = {
  resumen: { texto: 'Resumen', icono: <DashboardOutlined /> },
  usuarios: { texto: 'Usuarios y roles', icono: <TeamOutlined /> },
  uso: { texto: 'Plan y uso', icono: <PieChartOutlined /> },
  facturacion: { texto: 'Facturación', icono: <CreditCardOutlined /> },
  integraciones: { texto: 'Integraciones', icono: <ApiOutlined /> },
  seguridad: { texto: 'Seguridad', icono: <LockOutlined /> },
  auditoria: { texto: 'Auditoría', icono: <AuditOutlined /> },
} as const
export type PestanaOrganizacion = keyof typeof PESTANAS_ORGANIZACION

function MarcoOrganizacion() {
  const yo = useYo()
  const pestana = useRouterState({ select: (s) => (s.location.search as { pestana?: string }).pestana ?? 'resumen' })
  if (yo.isPending) return <Cargando />
  if (yo.isError) return <Problema error={yo.error} />
  const { actor, impersonacion } = yo.data
  if (!actor) return <Navigate to="/entrar" />
  if (actor.tipo === 'plataforma' && !impersonacion) return <Navigate to="/plataforma" />
  const persona = actor.tipo === 'tenant' ? actor : impersonacion!
  if (persona.rol !== 'admin')
    return (
      <div className="entrar">
        <Problema error={new Error('Este panel es solo para el administrador de tu organización.')} />
      </div>
    )
  return (
    <Marco
      titulo={persona.tenantNombre}
      subtitulo="Administración de la organización"
      persona={actor.tipo === 'plataforma' ? { nombre: actor.nombre, detalle: 'Equipo de la plataforma' } : { nombre: actor.nombre, detalle: actor.correo }}
      aviso={impersonacion ? <AvisoImpersonacion /> : undefined}
      enlaces={(Object.keys(PESTANAS_ORGANIZACION) as PestanaOrganizacion[]).map((p) => ({ a: '/organizacion', search: { pestana: p }, texto: PESTANAS_ORGANIZACION[p].texto, icono: PESTANAS_ORGANIZACION[p].icono, activo: pestana === p }))}
    >
      <Outlet />
    </Marco>
  )
}

const raiz = createRootRoute({ component: Outlet, notFoundComponent: () => <Navigate to="/" /> })
const inicio = createRoute({ getParentRoute: () => raiz, path: '/', component: Inicio })
const entrar = createRoute({ getParentRoute: () => raiz, path: '/entrar', component: Entrar })
const plataforma = createRoute({ getParentRoute: () => raiz, path: '/plataforma', component: MarcoPlataforma })
const resumen = createRoute({ getParentRoute: () => plataforma, path: '/', component: Resumen })

export type BusquedaClientes = {
  q?: string
  estado?: string
  plan?: string
  pago?: string
  salud?: string
  uso?: string
  actividad?: string
  creadoDesde?: string
  creadoHasta?: string
  orden?: string
  dir?: 'asc' | 'desc'
  pagina?: number
  porPagina?: number
}
const clientes = createRoute({
  getParentRoute: () => plataforma,
  path: 'clientes',
  validateSearch: (s: Record<string, unknown>): BusquedaClientes => ({
    q: texto(s.q),
    estado: texto(s.estado),
    plan: texto(s.plan),
    pago: texto(s.pago),
    salud: texto(s.salud),
    uso: texto(s.uso),
    actividad: texto(s.actividad),
    creadoDesde: texto(s.creadoDesde),
    creadoHasta: texto(s.creadoHasta),
    orden: texto(s.orden),
    dir: s.dir === 'asc' || s.dir === 'desc' ? s.dir : undefined,
    pagina: numero(s.pagina),
    porPagina: numero(s.porPagina),
  }),
  component: Clientes,
})
export const PESTANAS_CLIENTE = ['general', 'usuarios', 'actividad', 'uso', 'facturacion', 'seguridad', 'auditoria'] as const
export type PestanaCliente = (typeof PESTANAS_CLIENTE)[number]
const cliente = createRoute({
  getParentRoute: () => plataforma,
  path: 'clientes/$id',
  validateSearch: (s: Record<string, unknown>): { pestana?: PestanaCliente } => ({ pestana: PESTANAS_CLIENTE.includes(s.pestana as PestanaCliente) ? (s.pestana as PestanaCliente) : undefined }),
  component: Cliente,
})
const alertas = createRoute({
  getParentRoute: () => plataforma,
  path: 'alertas',
  validateSearch: (s: Record<string, unknown>): { prioridad?: string; tipo?: string } => ({ prioridad: texto(s.prioridad), tipo: texto(s.tipo) }),
  component: Alertas,
})
const actividad = createRoute({ getParentRoute: () => plataforma, path: 'actividad', validateSearch: (s: Record<string, unknown>): { dias?: number } => ({ dias: numero(s.dias) }), component: Actividad })

export type BusquedaAuditoria = { categoria?: string; tipo?: string; tenant?: string; severidad?: string; desde?: string; hasta?: string; pagina?: number; porPagina?: number }
const auditoria = createRoute({
  getParentRoute: () => plataforma,
  path: 'auditoria',
  validateSearch: (s: Record<string, unknown>): BusquedaAuditoria => ({
    categoria: texto(s.categoria),
    tipo: texto(s.tipo),
    tenant: texto(s.tenant),
    severidad: texto(s.severidad),
    desde: texto(s.desde),
    hasta: texto(s.hasta),
    pagina: numero(s.pagina),
    porPagina: numero(s.porPagina),
  }),
  component: Auditoria,
})
const organizacion = createRoute({ getParentRoute: () => raiz, path: '/organizacion', component: MarcoOrganizacion })
const panel = createRoute({
  getParentRoute: () => organizacion,
  path: '/',
  validateSearch: (s: Record<string, unknown>): { pestana?: PestanaOrganizacion } => ({ pestana: typeof s.pestana === 'string' && s.pestana in PESTANAS_ORGANIZACION ? (s.pestana as PestanaOrganizacion) : undefined }),
  component: Organizacion,
})

export const router = createRouter({
  routeTree: raiz.addChildren([inicio, entrar, plataforma.addChildren([resumen, clientes, cliente, alertas, actividad, auditoria]), organizacion.addChildren([panel])]),
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
