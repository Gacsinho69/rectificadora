// La primera pantalla del taller: cuántos motores hay en cada etapa, qué va atrasado o detenido, cuánta carga tiene cada
// sección y, para quien ve montos, cómo va lo cotizado. El técnico ve primero sus trabajos, en el orden en que tocan.
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Problema, useAngosto } from '../../../pantallas/componentes'
import { cifra, fecha, plata, porcentaje } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { folioOc } from '../../compras/reglas'
import { AvanceOt, dias, DondeRetirar, EstadoOtTag, folioOt, horas, PlazoTag, SituacionTag, usePersona, usePortal } from './comun'
import { FichaTrabajo } from './FichaTrabajo'
import type { Inicio as DatosInicio } from './tipos'
import { BotonesDeTarea, useAccionesDeTarea } from './Trabajo'

export function Inicio() {
  const portal = usePortal()
  const { persona, gestiona, tiene } = usePersona()
  const ir = useNavigate()
  const [ficha, setFicha] = useState<string | null>(null)
  const r = useQuery({ queryKey: ['taller', 'inicio'], queryFn: () => api<DatosInicio>('GET', '/servicio/inicio') })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const d = r.data
  const aOts = (estado: string) => () => ir({ to: '/c/$portal/ot', params: { portal }, search: { estado } })
  const maxHoras = Math.max(1, ...d.carga.map((s) => s.ahora))
  return (
    <>
      <Encabezado
        titulo={`Hola, ${persona?.nombre.split(' ')[0] ?? ''}`}
        sub={`${persona?.tenantNombre ?? ''} · ${fecha(new Date().toISOString())}`}
        acciones={gestiona ? <Button type="primary" onClick={() => ir({ to: '/c/$portal/ot', params: { portal }, search: { recibir: '1' } })}>Recibir motor</Button> : null}
      />
      {/* El técnico y el chofer ven primero lo suyo; el jefe, primero cómo va el taller. */}
      {!gestiona && <MisCosas d={d} abrir={setFicha} />}
      <Cifras
        cifras={[
          { rotulo: 'Recibidas y en diagnóstico', valor: cifra(d.cifras.recibidas), enlace: aOts('received,diagnosis') },
          { rotulo: 'Esperando aprobación', valor: cifra(d.cifras.esperando), enlace: aOts('waiting_approval') },
          { rotulo: 'En taller', valor: cifra(d.cifras.enTaller), enlace: aOts('in_progress') },
          { rotulo: 'Control de calidad', valor: cifra(d.cifras.calidad), enlace: aOts('quality') },
          { rotulo: 'Listas para entregar', valor: cifra(d.cifras.listas), tono: d.cifras.listas ? 'verde' : undefined, enlace: aOts('ready') },
          { rotulo: 'Atrasadas', valor: cifra(d.cifras.atrasadas), nota: `${d.cifras.porVencer} por vencer`, tono: d.cifras.atrasadas ? 'rojo' : undefined },
          { rotulo: 'Esperan repuestos', valor: cifra(d.cifras.esperanRepuestos), nota: 'trabajos sin sus repuestos', tono: d.cifras.esperanRepuestos ? 'dorado' : undefined, enlace: () => (tiene('purchasing') ? ir({ to: '/c/$portal/compras', params: { portal } }) : ir({ to: '/c/$portal/taller', params: { portal } })) },
          d.cifras.esperanMaquina > 0 && { rotulo: 'Esperan su máquina', valor: cifra(d.cifras.esperanMaquina), nota: 'su máquina está detenida', tono: 'naranjo', enlace: () => ir({ to: '/c/$portal/maquinas', params: { portal } }) },
          { rotulo: 'Trabajos detenidos', valor: cifra(d.cifras.detenidos), nota: 'cliente, terceros…', tono: d.cifras.detenidos ? 'naranjo' : undefined, enlace: () => ir({ to: '/c/$portal/taller', params: { portal } }) },
          { rotulo: 'Entregadas este mes', valor: cifra(d.cifras.entregadasMes), enlace: aOts('delivered') },
        ]}
      />
      {d.comercial && (
        <Cifras
          cifras={[
            { rotulo: 'Cotizado este mes', valor: plata(d.comercial.cotizadoMes), nota: `${d.comercial.enviadasMes} cotizaciones enviadas`, enlace: () => ir({ to: '/c/$portal/cotizaciones', params: { portal } }) },
            { rotulo: 'Aceptado este mes', valor: plata(d.comercial.aceptadoMes), nota: `${d.comercial.aceptadasMes} cotizaciones` },
            { rotulo: 'Esperando respuesta', valor: plata(d.comercial.montoPendiente), nota: `${d.comercial.pendientes} cotizaciones`, enlace: () => ir({ to: '/c/$portal/cotizaciones', params: { portal }, search: { estado: 'sent' } }) },
            { rotulo: 'Tasa de aceptación', valor: d.comercial.tasaAceptacion === null ? '—' : porcentaje(d.comercial.tasaAceptacion), nota: 'Últimos 90 días' },
          ]}
        />
      )}
      {gestiona && <MisCosas d={d} abrir={setFicha} />}
      <div className="columnas tres-dos">
        <Bloque titulo="Atrasadas, por vencer, urgentes y listas" extra={<Link to="/c/$portal/ot" params={{ portal }}>Todas las OT</Link>}>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={d.urgentes}
            scroll={{ x: 560 }}
            locale={{ emptyText: 'Todo a tiempo.' }}
            rowClassName={() => 'fila-abre'}
            onRow={(o) => ({ onClick: () => ir({ to: '/c/$portal/ot/$id', params: { portal, id: o.id } }) })}
            columns={[
              { title: 'OT', key: 'n', render: (_, o) => <div className="fila-nombre"><b>{folioOt(o.numero)}</b><small>{o.cliente}</small></div> },
              { title: 'Motor', dataIndex: 'motor' },
              { title: 'Estado', key: 'e', render: (_, o) => <EstadoOtTag estado={o.estado} /> },
              { title: 'Avance', key: 'a', render: (_, o) => <AvanceOt estado={o.estado} fraccion={o.avance ?? 0} ancho={50} /> },
              { title: 'Entrega', key: 'p', render: (_, o) => <span className="evento-nombre">{o.entrega ? fecha(`${o.entrega}T12:00:00Z`) : '—'} <PlazoTag plazo={o.plazo} />{o.prioridad === 'urgent' && <span className="estado rojo">Urgente</span>}</span> },
            ]}
          />
        </Bloque>
        <Bloque titulo="Carga por sección" extra={<Link to="/c/$portal/carga" params={{ portal }}>Ver la carga</Link>}>
          <Table
            size="small"
            rowKey="seccionId"
            pagination={false}
            dataSource={d.carga}
            scroll={{ x: 440 }}
            columns={[
              { title: 'Sección', dataIndex: 'nombre' },
              {
                title: 'Para hacer ahora',
                key: 'h',
                render: (_, s) => (
                  <span className="medidor">
                    <span className="medidor-barra azul" style={{ width: 48 }}>
                      <span style={{ width: `${(s.ahora / maxHoras) * 100}%` }} />
                    </span>
                    <span className="medidor-valor">{horas(Math.round(s.ahora))}</span>
                  </span>
                ),
              },
              { title: 'Esperan', dataIndex: 'espera', align: 'right', render: (v: number) => (v ? horas(Math.round(v)) : <span className="tenue">—</span>) },
              { title: 'Detenidos', dataIndex: 'detenidos', align: 'right', render: (v: number) => (v ? <span className="estado naranjo">{v}</span> : <span className="tenue">—</span>) },
              { title: 'Cola', dataIndex: 'dias', align: 'right', render: (v: number | null) => <span style={{ whiteSpace: 'nowrap' }}>{dias(v === null ? null : Math.round(v * 10) / 10)}</span> },
            ]}
          />
        </Bloque>
      </div>
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
  const botones = (t: DatosInicio['misTareas'][number]) => <BotonesDeTarea t={{ ...t, asignadoId: persona?.id ?? null }} yo={persona?.id} gestiona={gestiona} trabaja={trabaja && !suspendida} accion={accion} />
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
