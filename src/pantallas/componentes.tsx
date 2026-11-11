// Las piezas que se repiten en todas las pantallas: bloques, cifras, estados, medidores, el gráfico de barras y la
// tabla de eventos. El color va solo en los estados y siempre junto a su texto, nunca solo.
import { Alert, Skeleton, Table, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import type { Prioridad } from '../modulos/alertas/reglas'
import { PRIORIDADES } from '../modulos/alertas/reglas'
import type { EventoVisible } from '../modulos/eventos/consulta'
import type { Severidad } from '../modulos/eventos/tipos'
import { ESTADOS_FACTURA, type EstadoFactura } from '../modulos/facturacion/reglas'
import { ESTADOS_INTEGRACION, type EstadoIntegracion } from '../modulos/integraciones/reglas'
import { ESTADOS_SALUD, type EstadoSalud, type Salud } from '../modulos/salud/reglas'
import { ESTADOS_PAGO, ESTADOS_TENANT, type EstadoPago, type EstadoTenant } from '../modulos/tenants/reglas'
import { ESTADOS_USUARIO, type EstadoUsuario } from '../modulos/usuarios/reglas'
import { Rechazo } from './api'
import { cifraCorta, fechaHora, hace, porcentaje } from './formato'

export type Tono = 'gris' | 'azul' | 'verde' | 'rojo' | 'naranjo' | 'dorado'

export function Estado({ tono = 'gris', children, titulo }: { tono?: Tono; children: React.ReactNode; titulo?: string }) {
  return (
    <span className={`estado ${tono}`} title={titulo}>
      {children}
    </span>
  )
}

const TONO_TENANT: Record<EstadoTenant, Tono> = { active: 'verde', trial: 'azul', past_due: 'naranjo', suspended: 'rojo', cancelled: 'gris' }
const TONO_PAGO: Record<EstadoPago, Tono> = { paid: 'verde', past_due: 'naranjo', failed: 'rojo', cancelled: 'gris', none: 'gris' }
const TONO_SALUD: Record<EstadoSalud, Tono> = { healthy: 'verde', warning: 'dorado', at_risk: 'naranjo', critical: 'rojo' }
const TONO_PRIORIDAD: Record<Prioridad, Tono> = { critical: 'rojo', high: 'naranjo', medium: 'dorado', low: 'gris' }
const TONO_SEVERIDAD: Record<Severidad, Tono> = { critical: 'rojo', error: 'rojo', warning: 'naranjo', info: 'gris' }
const TONO_USUARIO: Record<EstadoUsuario, Tono> = { active: 'verde', blocked: 'rojo', invited: 'azul' }
const TONO_FACTURA: Record<EstadoFactura, Tono> = { paid: 'verde', open: 'azul', past_due: 'naranjo', failed: 'rojo', cancelled: 'gris' }
const TONO_INTEGRACION: Record<EstadoIntegracion, Tono> = { active: 'verde', failing: 'rojo', disabled: 'gris' }

export const EstadoTenantTag = ({ estado }: { estado: EstadoTenant }) => <Estado tono={TONO_TENANT[estado]}>{ESTADOS_TENANT[estado]}</Estado>
export const PagoTag = ({ estado }: { estado: EstadoPago }) => <Estado tono={TONO_PAGO[estado]}>{ESTADOS_PAGO[estado]}</Estado>
export const PrioridadTag = ({ prioridad }: { prioridad: Prioridad }) => <Estado tono={TONO_PRIORIDAD[prioridad]}>{PRIORIDADES[prioridad]}</Estado>
export const EstadoUsuarioTag = ({ estado }: { estado: EstadoUsuario }) => <Estado tono={TONO_USUARIO[estado]}>{ESTADOS_USUARIO[estado]}</Estado>
export const FacturaTag = ({ estado }: { estado: EstadoFactura }) => <Estado tono={TONO_FACTURA[estado]}>{ESTADOS_FACTURA[estado]}</Estado>
export const IntegracionTag = ({ estado }: { estado: EstadoIntegracion }) => <Estado tono={TONO_INTEGRACION[estado]}>{ESTADOS_INTEGRACION[estado]}</Estado>
export const SeveridadTag = ({ severidad }: { severidad: Severidad }) =>
  severidad === 'info' ? null : <Estado tono={TONO_SEVERIDAD[severidad]}>{{ critical: 'Crítico', error: 'Error', warning: 'Aviso', info: '' }[severidad]}</Estado>

/** La salud con su puntaje; al pasar el mouse, los factores que la explican. */
export function SaludTag({ salud }: { salud: Salud | null }) {
  if (!salud) return <span className="tenue">—</span>
  return (
    <Tooltip
      title={
        <div className="factores">
          {salud.factores.map((f) => (
            <div key={f.clave}>
              <span>{f.nombre}</span>
              <b>
                {f.puntos}/{f.maximo}
              </b>
            </div>
          ))}
        </div>
      }
    >
      <Estado tono={TONO_SALUD[salud.estado]}>
        {ESTADOS_SALUD[salud.estado]} · {salud.puntaje}
      </Estado>
    </Tooltip>
  )
}

export function Bloque({ titulo, extra, children, id }: { titulo?: React.ReactNode; extra?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="bloque" id={id}>
      {(titulo || extra) && (
        <header>
          <h2>{titulo}</h2>
          {extra && <div className="bloque-extra">{extra}</div>}
        </header>
      )}
      <div className="bloque-cuerpo">{children}</div>
    </section>
  )
}

export type Cifra = { rotulo: React.ReactNode; valor: React.ReactNode; nota?: React.ReactNode; tono?: Tono; enlace?: () => void }

/** Cifras a lo ancho y en fila: el rótulo arriba, el valor grande, una nota chica abajo. */
export function Cifras({ cifras }: { cifras: (Cifra | false | null | undefined)[] }) {
  return (
    <dl className="cifras">
      {cifras
        .filter((c): c is Cifra => Boolean(c))
        .map((c, i) => (
          <div key={i} className={`${c.tono ? `tono-${c.tono}` : ''}${c.enlace ? ' con-enlace' : ''}`} onClick={c.enlace} role={c.enlace ? 'link' : undefined} tabIndex={c.enlace ? 0 : undefined} onKeyDown={(e) => c.enlace && e.key === 'Enter' && c.enlace()}>
            <dt>{c.rotulo}</dt>
            <dd>{c.valor}</dd>
            {c.nota && <small>{c.nota}</small>}
          </div>
        ))}
    </dl>
  )
}

/** Cuánto del límite va usado. El relleno lleva la severidad; el fondo es el mismo tono, más claro. */
export function Medidor({ fraccion, ancho = 90 }: { fraccion: number; ancho?: number }) {
  const nivel = fraccion >= 0.9 ? 'rojo' : fraccion >= 0.8 ? 'naranjo' : 'azul'
  return (
    <span className="medidor" title={porcentaje(fraccion)}>
      <span className={`medidor-barra ${nivel}`} style={{ width: ancho }}>
        <span style={{ width: `${Math.min(100, fraccion * 100)}%` }} />
      </span>
      <span className="medidor-valor">{porcentaje(fraccion)}</span>
    </span>
  )
}

export const Hace = ({ iso }: { iso: string | null | undefined }) => (
  <span title={iso ? fechaHora(iso) : undefined} className={iso ? undefined : 'tenue'}>
    {hace(iso)}
  </span>
)

export function Problema({ error }: { error: unknown }) {
  const mensaje = error instanceof Rechazo || error instanceof Error ? error.message : 'No se pudo cargar.'
  return <Alert type="error" showIcon title={mensaje} className="problema" />
}

export const Cargando = () => (
  <div className="cargando">
    <Skeleton active paragraph={{ rows: 6 }} />
  </div>
)

/**
 * Columnas de una sola serie, con su eje, el máximo rotulado y el valor de cada barra al pasar el mouse. Debajo, la
 * misma serie como tabla, para leerla sin depender del mouse ni del color.
 */
export function Barras({ datos, alto = 140, formato = cifraCorta, nombre }: { datos: { etiqueta: string; valor: number; detalle?: string }[]; alto?: number; formato?: (n: number) => string; nombre: string }) {
  const [tabla, setTabla] = useState(false)
  const [encima, setEncima] = useState<number | null>(null)
  if (!datos.length) return <p className="tenue">Sin datos en este período.</p>
  const max = Math.max(1, ...datos.map((d) => d.valor))
  const ejeAncho = 40
  const ranura = 100 / datos.length
  const iMax = datos.findIndex((d) => d.valor === max)
  return (
    <div className="barras">
      <div className="barras-lienzo" style={{ height: alto }} onMouseLeave={() => setEncima(null)} role="img" aria-label={`${nombre}: máximo ${formato(max)} (${datos[iMax]?.etiqueta})`}>
        <div className="barras-eje" style={{ width: ejeAncho }}>
          <span>{formato(max)}</span>
          <span>{formato(Math.round(max / 2))}</span>
          <span>0</span>
        </div>
        <div className="barras-area">
          <div className="barras-guia" style={{ top: 0 }} />
          <div className="barras-guia" style={{ top: '50%' }} />
          {datos.map((d, i) => (
            <div key={d.etiqueta} className={`barras-ranura${encima === i ? ' encima' : ''}`} style={{ left: `${i * ranura}%`, width: `${ranura}%` }} onMouseEnter={() => setEncima(i)}>
              <div className="barras-barra" style={{ height: `${(d.valor / max) * 100}%` }} />
            </div>
          ))}
          {iMax >= 0 && encima === null && (
            <span className="barras-rotulo" style={{ left: `${(iMax + 0.5) * ranura}%`, bottom: '100%' }}>
              {formato(max)}
            </span>
          )}
          {encima !== null && (
            <div className="barras-tooltip" style={{ left: `${(encima + 0.5) * ranura}%` }}>
              <b>{formato(datos[encima].valor)}</b> {nombre.toLowerCase()}
              <span>{datos[encima].detalle ?? datos[encima].etiqueta}</span>
            </div>
          )}
        </div>
      </div>
      <div className="barras-pie" style={{ paddingLeft: ejeAncho }}>
        <span>{datos[0].etiqueta}</span>
        <button type="button" className="enlace" onClick={() => setTabla(!tabla)}>
          {tabla ? 'Ocultar tabla' : 'Ver como tabla'}
        </button>
        <span>{datos.at(-1)!.etiqueta}</span>
      </div>
      {tabla && (
        <Table
          size="small"
          rowKey="etiqueta"
          pagination={false}
          scroll={{ y: 220 }}
          dataSource={[...datos].reverse()}
          columns={[
            { title: 'Período', dataIndex: 'etiqueta' },
            { title: nombre, dataIndex: 'valor', align: 'right', render: (v: number) => formato(v) },
          ]}
        />
      )}
    </div>
  )
}

/** Lo importante de los datos de un evento, en una línea. */
export function resumenDeEvento(e: Pick<EventoVisible, 'metadata' | 'eventType'>): string {
  const m = e.metadata as Record<string, any>
  const partes: string[] = []
  const valor = (v: unknown) => (v && typeof v === 'object' ? Object.entries(v as object).map(([k, x]) => `${k}: ${x}`).join(', ') || '—' : String(v))
  if (m.antes !== undefined || m.despues !== undefined) partes.push(`${valor(m.antes ?? '—')} → ${valor(m.despues ?? '—')}`)
  if (m.funcion) partes.push(`${m.funcion}: ${m.activa ? 'encendida' : 'apagada'}`)
  if (m.mensaje) partes.push(String(m.mensaje))
  if (m.tarea) partes.push(`${m.tarea}${m.error ? `: ${m.error}` : ''}`)
  if (m.url) partes.push(`${m.url} (${m.respuesta ?? 'error'})`)
  if (m.que) partes.push(`${m.que}, ${m.filas ?? '?'} filas`)
  if (m.monto) partes.push(`$${Number(m.monto).toLocaleString('es-CL')}${m.motivo && e.eventType === 'billing.payment_failed' ? ` · ${m.motivo}` : ''}`)
  if (m.correo && e.eventType === 'user.failed_login') partes.push(String(m.correo))
  if (m.permiso) partes.push(`Permiso: ${m.permiso}`)
  if (m.recurso) partes.push(`Vio: ${m.recurso}`)
  if (m.tenant_objetivo || m.tenant_pedido) partes.push(`Cliente objetivo: ${m.tenant_objetivo ?? m.tenant_pedido}`)
  if (m.motivo && e.eventType !== 'billing.payment_failed' && !m.correo) partes.push(`Motivo: ${m.motivo}`)
  if (m.impersonation_id) partes.push('Hecho por soporte, entrando como el administrador')
  if (m.duracion_min !== undefined) partes.push(`Duró ${m.duracion_min} min`)
  if (m.pais && (e.eventType === 'user.login' || e.eventType === 'user.failed_login')) partes.push([m.ciudad, m.pais].filter(Boolean).join(', '))
  if (m.motor) partes.push(`Motor ${m.motor}`)
  return partes.join(' · ')
}

/** El registro de eventos, igual en la consola, la ficha del cliente y el panel del cliente. */
export function TablaEventos({
  filas,
  cargando,
  conCliente,
  paginacion,
  compacta,
}: {
  filas: EventoVisible[]
  cargando?: boolean
  conCliente?: (e: EventoVisible) => React.ReactNode
  paginacion?: { total: number; pagina: number; porPagina: number; cambiar: (pagina: number, porPagina: number) => void }
  compacta?: boolean
}) {
  const columnas: ColumnsType<EventoVisible> = [
    { title: 'Cuándo', dataIndex: 'createdAt', width: 132, render: (v: string) => <span title={v}>{fechaHora(v)}</span> },
    {
      title: 'Evento',
      key: 'evento',
      render: (_, e) => (
        <span className="evento-nombre">
          {e.nombre} <SeveridadTag severidad={e.severity} />
        </span>
      ),
    },
    ...(conCliente ? [{ title: 'Cliente', key: 'cliente', render: (_: unknown, e: EventoVisible) => conCliente(e) }] : []),
    { title: 'Quién', dataIndex: 'actorNombre', render: (v: string | null, e) => v ?? (e.actorType === 'anonymous' ? 'Desconocido' : '—') },
    ...(compacta ? [] : [{ title: 'Usuario', dataIndex: 'usuarioNombre', render: (v: string | null) => v ?? <span className="tenue">—</span> }]),
    { title: 'Detalle', key: 'detalle', render: (_, e) => <span className="detalle">{resumenDeEvento(e) || <span className="tenue">—</span>}</span> },
    ...(compacta ? [] : [{ title: 'IP', dataIndex: 'ipAddress', width: 124, render: (v: string | null) => <span className="mono">{v ?? '—'}</span> }]),
  ]
  return (
    <Table
      size="small"
      rowKey="id"
      loading={cargando}
      dataSource={filas}
      columns={columnas}
      scroll={{ x: 760 }}
      expandable={{
        expandedRowRender: (e) => (
          <pre className="metadatos">
            {JSON.stringify({ id: e.id, event_type: e.eventType, tenant_id: e.tenantId, actor_type: e.actorType, actor_id: e.actorId, user_id: e.userId, target_type: e.targetType, target_id: e.targetId, ip_address: e.ipAddress, user_agent: e.userAgent, metadata: e.metadata, created_at: e.createdAt }, null, 2)}
          </pre>
        ),
      }}
      pagination={
        paginacion
          ? { total: paginacion.total, current: paginacion.pagina, pageSize: paginacion.porPagina, showSizeChanger: true, pageSizeOptions: [25, 50, 100], onChange: paginacion.cambiar, showTotal: (t) => `${t.toLocaleString('es-CL')} eventos` }
          : false
      }
    />
  )
}
