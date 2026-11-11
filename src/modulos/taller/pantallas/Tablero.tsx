// El tablero del taller: una columna por sección con lo que falta hacer. Primero lo que está en proceso, después lo
// urgente y lo que vence antes. El técnico inicia y termina aquí; con «Solo mis trabajos» ve solo lo suyo.
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Segmented } from 'antd'
import { api } from '../../../pantallas/api'
import { Cargando, Hace, Problema } from '../../../pantallas/componentes'
import { fecha } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { EstadoTareaTag, folioOt, PlazoTag, usePersona, usePortal } from './comun'
import { BotonesDeTarea, useAccionesDeTarea } from './OrdenDeTrabajo'
import type { TarjetaTaller } from './tipos'

const ruta = getRouteApi('/c/$portal/taller')

export function Tablero() {
  const { mias } = ruta.useSearch()
  const portal = usePortal()
  const ir = useNavigate({ from: '/c/$portal/taller' })
  const { persona, gestiona, trabaja, suspendida } = usePersona()
  const tarea = useAccionesDeTarea()
  const r = useQuery({ queryKey: ['taller', 'tablero', mias], queryFn: () => api<{ secciones: { id: string; nombre: string; tareas: TarjetaTaller[] }[] }>('GET', `/servicio/taller${mias ? '?mias=1' : ''}`), refetchInterval: 60_000 })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const total = r.data.secciones.reduce((s, x) => s + x.tareas.length, 0)
  return (
    <>
      <Encabezado
        titulo="Taller"
        sub={`${total} trabajos por hacer o en proceso`}
        acciones={<Segmented value={mias ? 'mias' : 'todas'} onChange={(v) => ir({ search: { mias: v === 'mias' ? '1' : undefined }, replace: true })} options={[{ value: 'todas', label: 'Todo el taller' }, { value: 'mias', label: 'Solo mis trabajos' }]} />}
      />
      <div className="tablero">
        {r.data.secciones.map((s) => (
          <section key={s.id} className="tablero-columna">
            <header>
              <b>{s.nombre}</b>
              <span>{s.tareas.length}</span>
            </header>
            <div className="tablero-tarjetas">
              {s.tareas.length === 0 && <p className="tenue">Nada pendiente.</p>}
              {s.tareas.map((t) => (
                <article key={t.id} className={`tarjeta${t.estado === 'in_progress' ? ' en-proceso' : ''}${t.ot.plazo === 'atrasada' ? ' atrasada' : ''}`}>
                  <div className="tarjeta-cabeza">
                    <Link to="/c/$portal/ot/$id" params={{ portal, id: t.ot.id }}>
                      {folioOt(t.ot.numero)}
                    </Link>
                    <span className="evento-nombre">
                      <PlazoTag plazo={t.ot.plazo} />
                      {t.ot.prioridad === 'urgent' && <span className="estado rojo">Urgente</span>}
                    </span>
                  </div>
                  <b className="tarjeta-trabajo">{t.nombre}</b>
                  <small>
                    {t.ot.motor} · {t.cliente}
                  </small>
                  <small>
                    {t.asignado ?? 'Sin asignar'}
                    {t.horas ? ` · ${t.horas.toLocaleString('es-CL', { maximumFractionDigits: 1 })} h` : ''}
                    {t.ot.entrega ? ` · entrega ${fecha(`${t.ot.entrega}T12:00:00Z`)}` : ''}
                  </small>
                  <div className="tarjeta-pie">
                    <span className="evento-nombre">
                      <EstadoTareaTag estado={t.estado} />
                      {t.inicio && <span className="tenue">desde <Hace iso={t.inicio} /></span>}
                    </span>
                    {t.ot.estado === 'waiting_approval' ? <span className="tenue">Esperando aprobación</span> : <BotonesDeTarea t={t} yo={persona?.id} gestiona={gestiona} trabaja={trabaja && !suspendida} accion={tarea} />}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
