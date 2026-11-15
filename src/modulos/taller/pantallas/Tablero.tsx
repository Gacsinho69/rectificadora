// El tablero del taller, como un panel de control. Arriba, cuatro indicadores que a la vez filtran: lo que se está
// trabajando, lo que se puede empezar, lo que tiene problemas y lo que espera su turno. Debajo, una tarjeta por sección
// con cómo se reparten sus trabajos (tocarla deja solo esa sección). Al final, la lista: una fila corta por trabajo
// (qué es, quién, en qué está, cuándo se entrega), que se ordena por entrega, sección, persona o estado. Todo lo demás
// (cliente, qué falta, por qué se detuvo, detener) está en la ficha del trabajo. La vista elegida viaja en la dirección.
import { CloseOutlined } from '@ant-design/icons'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Segmented } from 'antd'
import { Fragment, useState } from 'react'
import { api } from '../../../pantallas/api'
import { Cargando, Problema } from '../../../pantallas/componentes'
import { cifra, plural } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { MOTIVOS_DETENCION, type Situacion } from '../reglas'
import { cuandoSeEntrega, diasHasta, dias, folioOt, textoEspera, textoFaltan, textoMaquinas, usePersona } from './comun'
import type { TarjetaTaller, Tablero as DatosTablero } from './tipos'
import { FichaTrabajo } from './FichaTrabajo'
import { BotonesDeTarea, useAccionesDeTarea } from './Trabajo'

const ruta = getRouteApi('/c/$portal/taller')

/** Los cuatro grupos del panel. Sin ninguno elegido se ve lo activo: todo menos lo que espera su turno. */
const GRUPOS = {
  trabajando: { nombre: 'Trabajándose', detalle: 'con alguien encima', situaciones: ['in_progress'] },
  empezar: { nombre: 'Para empezar', detalle: 'listos, nadie partió', situaciones: ['available'] },
  problemas: { nombre: 'Con problemas', detalle: 'detenidos o les falta algo', situaciones: ['held', 'machine', 'parts'] },
  fila: { nombre: 'En fila', detalle: 'esperan lo anterior de su pieza', situaciones: ['waiting'] },
} satisfies Record<string, { nombre: string; detalle: string; situaciones: Situacion[] }>
type Grupo = keyof typeof GRUPOS
const ACTIVOS: Situacion[] = ['in_progress', 'available', 'held', 'machine', 'parts']
const grupoDe = (s: Situacion): Grupo => (s === 'in_progress' ? 'trabajando' : s === 'available' ? 'empezar' : s === 'waiting' ? 'fila' : 'problemas')

const ORDENES = { entrega: 'Entrega', seccion: 'Sección', persona: 'Persona', estado: 'Estado' } as const
type Orden = keyof typeof ORDENES

/** En qué está un trabajo, en dos o tres palabras, con su color. El detalle va en el globo y en la ficha. */
type Marca = 'azul' | 'gris' | 'naranjo' | 'dorado' | 'fila' | 'verde'
function enQueEsta(t: TarjetaTaller): { texto: string; tono: Marca; detalle?: string } {
  if (t.ot.estado === 'waiting_approval') return { texto: 'Sin aprobar', tono: 'fila', detalle: 'La cotización espera la respuesta del cliente.' }
  switch (t.situacion) {
    case 'in_progress':
      return { texto: 'Trabajando', tono: 'azul' }
    case 'available':
      return { texto: 'Para empezar', tono: 'gris' }
    case 'held':
      return { texto: 'Detenido', tono: 'naranjo', detalle: t.detencion ? `${MOTIVOS_DETENCION[t.detencion.motivo]}${t.detencion.nota ? `: ${t.detencion.nota}` : ''}` : undefined }
    case 'machine':
      return { texto: 'Sin máquina', tono: 'naranjo', detalle: textoMaquinas(t.maquinas) }
    case 'parts':
      return { texto: 'Sin repuestos', tono: 'dorado', detalle: textoFaltan(t.faltan) }
    case 'waiting':
      return { texto: 'En fila', tono: 'fila', detalle: textoEspera(t.espera) }
    default:
      return { texto: 'Terminado', tono: 'verde' }
  }
}

/** Para ordenar por entrega: lo que vence antes primero; a igual fecha, lo urgente; sin fecha, al final. */
const pesoEntrega = (t: TarjetaTaller) => (t.ot.entrega ? diasHasta(t.ot.entrega) : 9_999) * 2 - (t.ot.prioridad === 'urgent' ? 1 : 0)
/** Para ordenar por estado: primero lo que tiene problemas, después lo que se trabaja, lo que se puede empezar y la fila. */
const PESO_GRUPO: Record<Grupo, number> = { problemas: 0, trabajando: 1, empezar: 2, fila: 3 }

export function Tablero() {
  const busqueda = ruta.useSearch()
  const { gestiona } = usePersona()
  // El técnico abre en lo suyo; el jefe de taller, en todo el taller. Cada uno puede cambiar.
  const mias = busqueda.mias === undefined ? !gestiona : busqueda.mias === '1'
  const grupo: Grupo | null = busqueda.ver && busqueda.ver in GRUPOS ? (busqueda.ver as Grupo) : null
  const orden: Orden = busqueda.orden && busqueda.orden in ORDENES ? (busqueda.orden as Orden) : 'entrega'
  const ir = useNavigate({ from: '/c/$portal/taller' })
  const cambiar = (c: { ver?: string; orden?: string; seccion?: string; mias?: '1' | '0' }) => ir({ search: (s) => ({ ...s, ...c }), replace: true })
  const [ficha, setFicha] = useState<string | null>(null)
  const r = useQuery({ queryKey: ['taller', 'tablero', mias], queryFn: () => api<DatosTablero>('GET', `/servicio/taller${mias ? '?mias=1' : ''}`), refetchInterval: 60_000, placeholderData: keepPreviousData })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />

  const secciones = r.data.secciones
  const nombreSeccion = new Map(secciones.map((s) => [s.id, s.nombre]))
  const seccion = busqueda.seccion && nombreSeccion.has(busqueda.seccion) ? busqueda.seccion : null
  const todas = secciones.flatMap((s) => s.tareas)
  const deLaSeccion = seccion ? todas.filter((t) => t.seccionId === seccion) : todas
  const cuantas = (g: Grupo) => deLaSeccion.filter((t) => grupoDe(t.situacion) === g).length
  const atrasadas = (g: Grupo) => deLaSeccion.filter((t) => grupoDe(t.situacion) === g && t.ot.plazo === 'atrasada').length
  const visibles = deLaSeccion.filter((t) => (grupo ? (GRUPOS[grupo].situaciones as Situacion[]).includes(t.situacion) : ACTIVOS.includes(t.situacion)))

  // El orden y, salvo por entrega, los grupos de la lista con su título.
  const titulo = (t: TarjetaTaller) =>
    orden === 'seccion' ? (nombreSeccion.get(t.seccionId) ?? '') : orden === 'persona' ? (t.asignado ?? 'Sin asignar') : orden === 'estado' ? GRUPOS[grupoDe(t.situacion)].nombre : ''
  const filas = [...visibles].sort((a, b) => {
    if (orden === 'seccion') return secciones.findIndex((s) => s.id === a.seccionId) - secciones.findIndex((s) => s.id === b.seccionId) || pesoEntrega(a) - pesoEntrega(b)
    if (orden === 'persona') return (a.asignado ? 0 : 1) - (b.asignado ? 0 : 1) || (a.asignado ?? '').localeCompare(b.asignado ?? '', 'es') || pesoEntrega(a) - pesoEntrega(b)
    if (orden === 'estado') return PESO_GRUPO[grupoDe(a.situacion)] - PESO_GRUPO[grupoDe(b.situacion)] || pesoEntrega(a) - pesoEntrega(b)
    return pesoEntrega(a) - pesoEntrega(b)
  })

  return (
    <>
      <Encabezado
        titulo="Tablero del taller"
        sub={seccion ? `Solo ${nombreSeccion.get(seccion)}` : mias ? 'Tus trabajos' : 'Todo el taller, al día de hoy'}
        acciones={<Segmented value={mias ? 'mias' : 'todas'} onChange={(v) => cambiar({ mias: v === 'mias' ? '1' : '0', seccion: undefined })} options={[{ value: 'todas', label: 'Todo el taller' }, { value: 'mias', label: 'Solo mis trabajos' }]} />}
      />

      {/* Los cuatro indicadores: el número grande y, tocándolo, la lista queda solo con eso. */}
      <div className={`panel-indicadores${mias ? ' solos' : ''}`} role="group" aria-label="Filtrar por estado">
        {(Object.keys(GRUPOS) as Grupo[]).map((g) => {
          const atr = atrasadas(g)
          return (
            <button key={g} type="button" className={`indicador ind-${g}${grupo === g ? ' elegido' : ''}`} aria-pressed={grupo === g} onClick={() => cambiar({ ver: grupo === g ? undefined : g })}>
              <span className="indicador-nombre">{GRUPOS[g].nombre}</span>
              <span className="indicador-numero">{cifra(cuantas(g))}</span>
              <span className="indicador-pie">{atr ? <b>{plural(atr, 'atrasado')}</b> : GRUPOS[g].detalle}</span>
            </button>
          )
        })}
      </div>

      {/* Una tarjeta por sección: sus trabajos activos y cómo se reparten. Tocarla deja solo esa sección. */}
      {!mias && (
        <section className="panel-secciones" aria-label="Por sección">
          {secciones.map((s) => {
            const activos = s.tareas.filter((t) => ACTIVOS.includes(t.situacion))
            const de = (g: Grupo) => s.tareas.filter((t) => grupoDe(t.situacion) === g).length
            const total = Math.max(1, s.tareas.length)
            return (
              <button key={s.id} type="button" className={`tarjeta-seccion${seccion === s.id ? ' elegida' : ''}`} aria-pressed={seccion === s.id} onClick={() => cambiar({ seccion: seccion === s.id ? undefined : s.id })}>
                <span className="tarjeta-seccion-nombre">{s.nombre}</span>
                <span className="tarjeta-seccion-numero">
                  {cifra(activos.length)} <small>{activos.length === 1 ? 'activo' : 'activos'}</small>
                </span>
                <span className="reparto" aria-hidden>
                  {(['problemas', 'trabajando', 'empezar', 'fila'] as Grupo[]).map((g) => (de(g) ? <span key={g} className={`reparto-${g}`} style={{ flexGrow: de(g) / total }} /> : null))}
                </span>
                <span className="tarjeta-seccion-pie">
                  {de('problemas') > 0 && <b>{de('problemas')} con problemas · </b>}
                  {s.dias === null ? 'sin gente' : s.dias < 0.05 ? 'al día' : `${dias(Math.round(s.dias * 10) / 10)} en fila`}
                </span>
              </button>
            )
          })}
        </section>
      )}

      {/* La lista: arriba cuántos hay, el filtro puesto (para sacarlo) y el orden. */}
      <div className="lista-barra">
        <span className="lista-barra-cuenta">
          {plural(filas.length, 'trabajo')}
          {grupo && (
            <button type="button" className="filtro-puesto" onClick={() => cambiar({ ver: undefined })}>
              {GRUPOS[grupo].nombre} <CloseOutlined />
            </button>
          )}
          {seccion && (
            <button type="button" className="filtro-puesto" onClick={() => cambiar({ seccion: undefined })}>
              {nombreSeccion.get(seccion)} <CloseOutlined />
            </button>
          )}
        </span>
        <span className="lista-barra-orden">
          <span className="tenue">Ordenar por</span>
          {(Object.keys(ORDENES) as Orden[]).map((o) => (
            <button key={o} type="button" aria-pressed={orden === o} onClick={() => cambiar({ orden: o === 'entrega' ? undefined : o })}>
              {ORDENES[o]}
            </button>
          ))}
        </span>
      </div>

      <div className={`lista-panel${r.isPlaceholderData ? ' actualizando' : ''}`}>
        {filas.length === 0 ? (
          <p className="lista-panel-vacia">{mias && !todas.length ? 'No tienes trabajos asignados. Te llegan solos si eres especialista de una actividad, o te los asigna el jefe de taller.' : 'Nada por aquí.'}</p>
        ) : (
          <>
            <div className="fila-panel encabezado-panel" aria-hidden>
              <span>OT</span>
              <span>Trabajo</span>
              <span>Persona</span>
              <span>Estado</span>
              <span>Entrega</span>
              <span />
            </div>
            {filas.map((t, i) => (
              <Fragment key={t.id}>
                {orden !== 'entrega' && (i === 0 || titulo(t) !== titulo(filas[i - 1])) && (
                  <div className="grupo-panel">
                    {titulo(t)}
                    <span>{filas.filter((x) => titulo(x) === titulo(t)).length}</span>
                  </div>
                )}
                <Fila t={t} seccion={orden === 'seccion' || seccion ? null : (nombreSeccion.get(t.seccionId) ?? null)} abrir={setFicha} />
              </Fragment>
            ))}
          </>
        )}
      </div>
      {ficha && <FichaTrabajo id={ficha} cerrar={() => setFicha(null)} />}
    </>
  )
}

function Fila({ t, seccion, abrir }: { t: TarjetaTaller; seccion: string | null; abrir: (id: string) => void }) {
  const { persona, gestiona, trabaja, suspendida } = usePersona()
  const accion = useAccionesDeTarea()
  const esta = enQueEsta(t)
  const entrega = cuandoSeEntrega(t.ot.entrega)
  const abre = () => abrir(t.id)
  return (
    <div className="fila-panel" onClick={abre} onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && abre()} tabIndex={0} role="button" aria-label={`${t.nombre}, ${folioOt(t.ot.numero)}: abrir la ficha`}>
      <span className="fila-panel-ot">{folioOt(t.ot.numero)}</span>
      <span className="fila-panel-que">
        <b>{t.nombre}</b>
        <small>
          {t.ot.motor}
          {seccion ? ` · ${seccion}` : ''}
        </small>
      </span>
      <span className="fila-panel-quien">{t.asignado ?? <span className="tenue">Sin asignar</span>}</span>
      <span className="fila-panel-estado">
        <span className={`estado ${esta.tono}`} title={esta.detalle}>
          {esta.texto}
        </span>
      </span>
      <span className={`fila-panel-cuando${entrega.tono ? ` tono-${entrega.tono}` : ''}`}>
        {entrega.texto}
        {t.ot.prioridad === 'urgent' && <i>Urgente</i>}
      </span>
      <span className="fila-panel-accion">{t.ot.estado !== 'waiting_approval' && <BotonesDeTarea t={t} yo={persona?.id} gestiona={gestiona} trabaja={trabaja && !suspendida} accion={accion} compacto />}</span>
    </div>
  )
}
