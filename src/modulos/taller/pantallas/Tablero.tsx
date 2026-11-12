// El tablero del taller: una columna por sección. Arriba, lo que se puede hacer ahora (primero lo que está en proceso,
// después lo atrasado, lo urgente y lo que vence antes); abajo, lo que espera su turno en la ruta de su pieza y lo
// detenido con su motivo. Cada columna dice su gente y su cola en días. Con «Solo mis trabajos», cada uno ve lo suyo.
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { Segmented } from 'antd'
import { api } from '../../../pantallas/api'
import { Cargando, Hace, Problema } from '../../../pantallas/componentes'
import { fecha, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { MOTIVOS_DETENCION, PIEZAS } from '../reglas'
import { dias, folioOt, horas, PlazoTag, SituacionTag, textoEspera, usePersona, usePortal } from './comun'
import type { TarjetaTaller, Tablero as DatosTablero } from './tipos'
import { BotonesDeTarea, useAccionesDeTarea } from './Trabajo'

const ruta = getRouteApi('/c/$portal/taller')

export function Tablero() {
  const { mias } = ruta.useSearch()
  const ir = useNavigate({ from: '/c/$portal/taller' })
  const r = useQuery({ queryKey: ['taller', 'tablero', mias], queryFn: () => api<DatosTablero>('GET', `/servicio/taller${mias ? '?mias=1' : ''}`), refetchInterval: 60_000 })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  // En «Solo mis trabajos», las secciones donde no hay nada mío sobran.
  const secciones = mias ? r.data.secciones.filter((s) => s.tareas.length) : r.data.secciones
  const todas = secciones.flatMap((s) => s.tareas)
  const cuantas = (...sit: TarjetaTaller['situacion'][]) => todas.filter((t) => sit.includes(t.situacion)).length
  return (
    <>
      <Encabezado
        titulo="Taller"
        sub={`${plural(cuantas('in_progress', 'available'), 'trabajo')} para hacer ahora · ${cuantas('waiting')} esperan su turno · ${plural(cuantas('held'), 'detenido')}`}
        acciones={<Segmented value={mias ? 'mias' : 'todas'} onChange={(v) => ir({ search: { mias: v === 'mias' ? '1' : undefined }, replace: true })} options={[{ value: 'todas', label: 'Todo el taller' }, { value: 'mias', label: 'Solo mis trabajos' }]} />}
      />
      {mias && !todas.length && <p className="tenue">No tienes trabajos asignados. Te llegan solos si eres especialista de una actividad, o te los asigna el jefe de taller.</p>}
      <div className="tablero">
        {secciones.map((s) => {
          const ahora = s.tareas.filter((t) => t.situacion === 'in_progress' || t.situacion === 'available')
          const esperan = s.tareas.filter((t) => t.situacion === 'waiting')
          const detenidas = s.tareas.filter((t) => t.situacion === 'held')
          return (
            <section key={s.id} className="tablero-columna">
              <header>
                <div>
                  <b>{s.nombre}</b>
                  <small title={s.gente.map((g) => g.nombre).join(', ')}>
                    {s.gente.length === 0 ? 'Sin especialistas' : s.gente.length === 1 ? s.gente[0].nombre : plural(s.gente.length, 'persona')} · {horas(Math.round(s.ahora))} para hacer · cola {dias(s.dias === null ? null : Math.round(s.dias * 10) / 10)}
                  </small>
                </div>
                <span title="Para hacer ahora">{ahora.length}</span>
              </header>
              <div className="tablero-tarjetas">
                {ahora.length === 0 && <p className="tenue">Nada para hacer ahora.</p>}
                {ahora.map((t) => (
                  <Tarjeta key={t.id} t={t} />
                ))}
                {detenidas.length > 0 && (
                  <div className="tablero-grupo">
                    <h3>Detenidos ({detenidas.length})</h3>
                    {detenidas.map((t) => (
                      <Tarjeta key={t.id} t={t} />
                    ))}
                  </div>
                )}
                {esperan.length > 0 && (
                  <details className="tablero-grupo">
                    <summary>Esperan su turno ({esperan.length})</summary>
                    <div className="tablero-grupo-lista">
                      {esperan.map((t) => (
                        <Tarjeta key={t.id} t={t} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}

function Tarjeta({ t }: { t: TarjetaTaller }) {
  const portal = usePortal()
  const { persona, gestiona, trabaja, suspendida } = usePersona()
  const accion = useAccionesDeTarea()
  const clase = t.situacion === 'held' ? ' detenida' : t.situacion === 'waiting' ? ' espera' : t.situacion === 'in_progress' ? ' en-proceso' : t.ot.plazo === 'atrasada' ? ' atrasada' : ''
  return (
    <article className={`tarjeta${clase}`}>
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
        {t.pieza !== 'motor' && `${PIEZAS[t.pieza]} · `}
        {t.ot.motor} · {t.cliente}
      </small>
      <small>
        {t.asignado ?? 'Sin asignar'}
        {t.horas ? ` · ${horas(t.horas)}` : ''}
        {t.ot.entrega ? ` · entrega ${fecha(`${t.ot.entrega}T12:00:00Z`)}` : ''}
      </small>
      {t.situacion === 'waiting' && <small className="tarjeta-aviso">{textoEspera(t.espera)}</small>}
      {t.situacion === 'held' && t.detencion && (
        <small className="tarjeta-aviso naranjo">
          {MOTIVOS_DETENCION[t.detencion.motivo]}
          {t.detencion.nota ? `: ${t.detencion.nota}` : ''} · <Hace iso={t.detencion.desde} />
        </small>
      )}
      <div className="tarjeta-pie">
        <span className="evento-nombre">
          <SituacionTag situacion={t.situacion} detencion={t.detencion} espera={t.espera} />
          {t.situacion === 'in_progress' && t.inicio && (
            <span className="tenue">
              desde <Hace iso={t.inicio} />
            </span>
          )}
        </span>
        {t.ot.estado === 'waiting_approval' ? <span className="tenue">Esperando aprobación</span> : <BotonesDeTarea t={t} yo={persona?.id} gestiona={gestiona} trabaja={trabaja && !suspendida} accion={accion} />}
      </div>
    </article>
  )
}
