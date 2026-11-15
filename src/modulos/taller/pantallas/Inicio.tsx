// La primera pantalla del taller. Para quien lo dirige, en este orden: lo que necesita su atención hoy (cada cosa con lo
// que hay que hacer), dónde están los motores, lo más urgente y cuánto trabajo tiene cada sección; abajo, si ve montos,
// cómo van las ventas del mes. El técnico y el chofer ven primero lo suyo, en el orden en que toca.
import { RightOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Problema, useAngosto } from '../../../pantallas/componentes'
import { cifra, fecha, plata, plural, porcentaje } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { folioOc } from '../../compras/reglas'
import { cuandoSeEntrega, dias, DondeRetirar, EstadoOtTag, folioOt, SituacionTag, usePersona, usePortal } from './comun'
import { FichaTrabajo } from './FichaTrabajo'
import type { Inicio as DatosInicio } from './tipos'
import { BotonesDeTarea, useAccionesDeTarea } from './Trabajo'

type Tono = 'rojo' | 'naranjo' | 'dorado' | 'verde' | 'azul'
type Pendiente = { tono: Tono; cuantos: number; que: string; hacer: string; abrir: () => void }

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function saludo(h: number) {
  return h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}

export function Inicio() {
  const portal = usePortal()
  const { persona, gestiona, tiene } = usePersona()
  const ir = useNavigate()
  const [ficha, setFicha] = useState<string | null>(null)
  const r = useQuery({ queryKey: ['taller', 'inicio'], queryFn: () => api<DatosInicio>('GET', '/servicio/inicio') })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const d = r.data
  const c = d.cifras
  const aOts = (estado: string, extra?: { delMes: '1' }) => () => ir({ to: '/c/$portal/ot', params: { portal }, search: { estado, ...extra } })
  const aUrgentes = () => document.getElementById('urgentes')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const aTaller = () => ir({ to: '/c/$portal/taller', params: { portal } })
  const ahora = new Date()
  // El técnico y el chofer con cosas propias ven solo lo suyo: el resto del taller lo mira el jefe.
  const soloLoSuyo = !gestiona && (d.misTareas.length > 0 || d.misRetiros.length > 0)

  const pendientes: Pendiente[] = [
    { tono: 'rojo' as const, cuantos: c.atrasadas, que: c.atrasadas === 1 ? 'OT atrasada' : 'OT atrasadas', hacer: 'Ya pasó la fecha que se le dio al cliente. Llámalo o apura el trabajo.', abrir: aUrgentes },
    { tono: 'naranjo' as const, cuantos: c.porVencer, que: c.porVencer === 1 ? 'OT vence en los próximos días' : 'OT vencen en los próximos días', hacer: 'Revisa que alcancen a salir a tiempo.', abrir: aUrgentes },
    { tono: 'verde' as const, cuantos: c.listas, que: c.listas === 1 ? 'Motor listo para entregar' : 'Motores listos para entregar', hacer: 'Avísale al cliente que puede venir a buscarlo.', abrir: aOts('ready') },
    {
      tono: 'azul' as const,
      cuantos: c.esperando,
      que: c.esperando === 1 ? 'Cotización espera la respuesta del cliente' : 'Cotizaciones esperan la respuesta del cliente',
      hacer: d.comercial?.montoPendiente ? `Son ${plata(d.comercial.montoPendiente)} por confirmar. Haz el seguimiento.` : 'Haz el seguimiento para que el motor pueda entrar al taller.',
      abrir: aOts('waiting_approval'),
    },
    { tono: 'dorado' as const, cuantos: c.esperanRepuestos, que: c.esperanRepuestos === 1 ? 'Trabajo espera repuestos' : 'Trabajos esperan repuestos', hacer: 'No se pueden terminar hasta que lleguen.', abrir: () => (tiene('purchasing') ? ir({ to: '/c/$portal/compras', params: { portal } }) : aTaller()) },
    { tono: 'naranjo' as const, cuantos: c.esperanMaquina, que: c.esperanMaquina === 1 ? 'Trabajo espera una máquina detenida' : 'Trabajos esperan una máquina detenida', hacer: 'Hasta que la máquina vuelva a funcionar.', abrir: () => ir({ to: '/c/$portal/maquinas', params: { portal } }) },
    { tono: 'naranjo' as const, cuantos: c.detenidos, que: c.detenidos === 1 ? 'Trabajo detenido' : 'Trabajos detenidos', hacer: 'Por el cliente, un tercero u otro motivo. Mira si alguno ya puede seguir.', abrir: aTaller },
  ].filter((p) => p.cuantos > 0)

  const etapas = [
    { cuantos: c.recibidas, nombre: 'Recibidos', detalle: 'y en diagnóstico', abrir: aOts('received,diagnosis') },
    { cuantos: c.esperando, nombre: 'Esperan aprobación', detalle: 'del cliente', abrir: aOts('waiting_approval') },
    { cuantos: c.enTaller, nombre: 'En el taller', detalle: 'trabajándose', abrir: aOts('in_progress') },
    { cuantos: c.calidad, nombre: 'Control de calidad', detalle: 'la última revisión', abrir: aOts('quality') },
    { cuantos: c.listas, nombre: 'Listos', detalle: 'para entregar', abrir: aOts('ready'), tono: c.listas ? 'verde' : undefined },
  ]
  const maxDias = Math.max(1, ...d.carga.map((s) => s.dias ?? 0))

  return (
    <>
      <Encabezado
        titulo={`${saludo(ahora.getHours())}, ${persona?.nombre.split(' ')[0] ?? ''}`}
        sub={`${DIAS_SEMANA[ahora.getDay()][0].toUpperCase()}${DIAS_SEMANA[ahora.getDay()].slice(1)} ${ahora.getDate()} de ${MESES[ahora.getMonth()]}`}
        acciones={gestiona ? <Button type="primary" size="large" onClick={() => ir({ to: '/c/$portal/ot', params: { portal }, search: { recibir: '1' } })}>Recibir motor</Button> : null}
      />
      {!gestiona && <MisCosas d={d} abrir={setFicha} />}
      {!soloLoSuyo && (
        <>
          {gestiona && (
            <section className="atencion" aria-labelledby="atencion-titulo">
              <h2 id="atencion-titulo">{pendientes.length ? 'Necesita tu atención' : 'Todo al día'}</h2>
              {pendientes.length ? (
                <ul>
                  {pendientes.map((p) => (
                    <li key={p.que}>
                      <button type="button" onClick={p.abrir} className={`atencion-fila ${p.tono}`}>
                        <span className="atencion-numero">{cifra(p.cuantos)}</span>
                        <span className="atencion-texto">
                          <b>{p.que}</b>
                          <small>{p.hacer}</small>
                        </span>
                        <RightOutlined className="atencion-flecha" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="atencion-vacia">Nada atrasado, detenido ni esperando. Buen trabajo.</p>
              )}
            </section>
          )}

          <section className="etapas" aria-labelledby="etapas-titulo">
            <header>
              <h2 id="etapas-titulo">Dónde están los motores</h2>
              <button type="button" className="enlace" onClick={aOts('delivered', { delMes: '1' })}>
                {plural(c.entregadasMes, 'entregado', 'entregados')} este mes
              </button>
            </header>
            <ol>
              {etapas.map((e) => (
                <li key={e.nombre}>
                  <button type="button" onClick={e.abrir} className={e.tono ? `tono-${e.tono}` : undefined}>
                    <span className="etapa-numero">{cifra(e.cuantos)}</span>
                    <b>{e.nombre}</b>
                    <small>{e.detalle}</small>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <div className="columnas tres-dos">
            <Bloque id="urgentes" titulo="Lo más urgente" extra={<Link to="/c/$portal/ot" params={{ portal }}>Todas las OT</Link>}>
              {d.urgentes.length ? (
                <ul className="lista-ot">
                  {d.urgentes.map((o) => {
                    const cuando = cuandoSeEntrega(o.entrega)
                    return (
                      <li key={o.id}>
                        <Link to="/c/$portal/ot/$id" params={{ portal, id: o.id }} className="fila-ot">
                          <span className="fila-ot-quien">
                            <b>{o.cliente}</b>
                            <small>
                              {folioOt(o.numero)} · {o.motor}
                            </small>
                          </span>
                          <span className="fila-ot-estado">
                            <EstadoOtTag estado={o.estado} />
                            {o.prioridad === 'urgent' && <span className="estado rojo">Urgente</span>}
                          </span>
                          <span className={`fila-ot-cuando${cuando.tono ? ` tono-${cuando.tono}` : ''}`}>{cuando.texto}</span>
                          <RightOutlined className="atencion-flecha" />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="tenue">Todo a tiempo.</p>
              )}
            </Bloque>
            <Bloque titulo="Trabajo de cada sección" extra={<Link to="/c/$portal/carga" params={{ portal }}>Ver detalle</Link>}>
              <ul className="lista-carga">
                {d.carga.map((s) => (
                  <li key={s.seccionId}>
                    <div className="carga-nombre">
                      <b>{s.nombre}</b>
                      <small>
                        {s.dias === null ? 'Sin gente asignada' : s.dias < 0.05 ? 'Al día' : `${dias(Math.round(s.dias * 10) / 10)} de trabajo en fila`}
                        {s.detenidos > 0 && <span className="carga-detenidos"> · {plural(s.detenidos, 'detenido')}</span>}
                      </small>
                    </div>
                    <span className="carga-barra" aria-hidden>
                      <span style={{ width: `${Math.min(100, ((s.dias ?? 0) / maxDias) * 100)}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </Bloque>
          </div>

          {d.comercial && (
            <section aria-labelledby="ventas-titulo">
              <h2 id="ventas-titulo" className="titulo-seccion">
                Ventas de {MESES[ahora.getMonth()]}
              </h2>
              <Cifras
                cifras={[
                  { rotulo: 'Cotizado', valor: plata(d.comercial.cotizadoMes), nota: plural(d.comercial.enviadasMes, 'cotización enviada', 'cotizaciones enviadas'), enlace: () => ir({ to: '/c/$portal/cotizaciones', params: { portal } }) },
                  { rotulo: 'Aceptado', valor: plata(d.comercial.aceptadoMes), nota: plural(d.comercial.aceptadasMes, 'cotización', 'cotizaciones') },
                  { rotulo: 'Por confirmar', valor: plata(d.comercial.montoPendiente), nota: plural(d.comercial.pendientes, 'cotización', 'cotizaciones'), enlace: () => ir({ to: '/c/$portal/cotizaciones', params: { portal }, search: { estado: 'sent' } }) },
                  { rotulo: 'Las acepta el cliente', valor: d.comercial.tasaAceptacion === null ? '—' : porcentaje(d.comercial.tasaAceptacion), nota: 'de las cotizaciones, últimos 90 días' },
                ]}
              />
            </section>
          )}
        </>
      )}
      {gestiona && <MisCosas d={d} abrir={setFicha} />}
      {ficha && <FichaTrabajo id={ficha} cerrar={() => setFicha(null)} />}
    </>
  )
}

/** Lo de quien mira: las órdenes de compra que tiene que ir a buscar y sus trabajos, en el orden en que tocan. */
function MisCosas({ d, abrir }: { d: DatosInicio; abrir: (id: string) => void }) {
  const portal = usePortal()
  return (
    <>
      {d.misRetiros.length > 0 && (
        <Bloque titulo={`Mis retiros (${d.misRetiros.length})`} extra={<Link to="/c/$portal/compras" params={{ portal }}>Abrir en compras</Link>}>
          <div className="retiros">
            {d.misRetiros.map((o) => (
              <article key={o.id} className="retiro">
                <div className="retiro-cabeza">
                  <b>
                    {folioOc(o.numero)} · {o.proveedor}
                  </b>
                  {o.llega && <span className="tenue">llega {fecha(`${o.llega}T12:00:00Z`)}</span>}
                </div>
                <DondeRetirar direccion={o.direccion} telefono={o.telefono} />
                <ul>
                  {o.repuestos.map((x, i) => (
                    <li key={i}>
                      {x.cantidad} × {x.descripcion}
                      {x.medida ? ` · ${x.medida}` : ''} <span className="tenue">({x.ot ? folioOt(x.ot) : 'bodega'})</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </Bloque>
      )}
      {d.misTareas.length > 0 && (
        <Bloque titulo={`Mis trabajos (${d.misTareas.length})`} extra={<Link to="/c/$portal/taller" params={{ portal }} search={{ mias: '1' }}>Abrir en el taller</Link>}>
          <MisTrabajos tareas={d.misTareas} abrir={abrir} />
        </Bloque>
      )}
    </>
  )
}

/** Mis trabajos: en el computador, una tabla; en el celular, una tarjeta por trabajo. Los dos con sus botones a mano. */
function MisTrabajos({ tareas, abrir }: { tareas: DatosInicio['misTareas']; abrir: (id: string) => void }) {
  const portal = usePortal()
  const angosto = useAngosto()
  const { persona, gestiona, trabaja, suspendida } = usePersona()
  const accion = useAccionesDeTarea()
  const botones = (t: DatosInicio['misTareas'][number]) => <BotonesDeTarea t={{ ...t, asignadoId: persona?.id ?? null }} yo={persona?.id} gestiona={gestiona} trabaja={trabaja && !suspendida} accion={accion} compacto />
  const ot = (t: DatosInicio['misTareas'][number]) => (
    <Link to="/c/$portal/ot/$id" params={{ portal, id: t.otId }} onClick={(e) => e.stopPropagation()}>
      {folioOt(t.ot)}
    </Link>
  )
  if (angosto)
    return (
      <div className="lista-tarjetas">
        {tareas.map((t) => (
          <article key={t.id} className={`tarjeta abre${t.situacion === 'in_progress' ? ' en-proceso' : ''}`} onClick={() => abrir(t.id)}>
            <div className="tarjeta-cabeza">
              {ot(t)}
              <span className="tenue">{t.entrega ? `entrega ${fecha(`${t.entrega}T12:00:00Z`)}` : ''}</span>
            </div>
            <b className="tarjeta-trabajo">{t.nombre}</b>
            <small>
              {t.motor} · {t.seccion}
            </small>
            <div className="tarjeta-pie">
              <SituacionTag situacion={t.situacion} espera={t.espera} faltan={t.faltan} maquinas={t.maquinas} />
              {botones(t)}
            </div>
          </article>
        ))}
      </div>
    )
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={tareas}
      rowClassName={() => 'fila-abre'}
      onRow={(t) => ({ onClick: () => abrir(t.id) })}
      columns={[
        { title: 'Trabajo', dataIndex: 'nombre', render: (v: string, t) => <div className="fila-nombre"><b>{v}</b><small>{t.seccion}</small></div> },
        { title: 'OT', key: 'ot', render: (_, t) => ot(t) },
        { title: 'Motor', dataIndex: 'motor' },
        { title: 'Situación', key: 's', render: (_, t) => <SituacionTag situacion={t.situacion} espera={t.espera} faltan={t.faltan} maquinas={t.maquinas} /> },
        { title: 'Entrega', dataIndex: 'entrega', render: (v: string | null) => (v ? fecha(`${v}T12:00:00Z`) : '—') },
        { title: '', key: 'b', width: 1, render: (_, t) => botones(t) },
      ]}
    />
  )
}
