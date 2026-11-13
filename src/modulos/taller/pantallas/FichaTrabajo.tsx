// La ficha de un trabajo: lo que el técnico necesita para hacerlo, en una sola vista y sin montos. El motor y la OT, lo
// que le indicó el jefe de taller, lo que ya se hizo en la misma pieza (con lo que anotó cada uno: «muñones a 0,25»),
// los repuestos que espera y, si le falta uno, pedirlo desde aquí. Al terminar anota lo que hizo o la medida final.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Alert, App, Button, Drawer, Form, Input, InputNumber } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Hace, Problema } from '../../../pantallas/componentes'
import { fecha, fechaHora } from '../../../pantallas/formato'
import { usePiezas } from './Piezas'
import { EstadoRepuestoTag, folioOt, horas, PlazoTag, SituacionTag, textoEspera, textoFaltan, textoMaquinas, textoMotor, usePersona, usePortal } from './comun'
import type { FichaTarea } from './tipos'
import { BotonesDeTarea, useAccionesDeTarea } from './Trabajo'

export function FichaTrabajo({ id, cerrar }: { id: string; cerrar: () => void }) {
  const r = useQuery({ queryKey: ['taller', 'tarea', id], queryFn: () => api<FichaTarea>('GET', `/servicio/tareas/${id}`) })
  return (
    <Drawer open onClose={cerrar} title={r.data?.nombre ?? 'Trabajo'} styles={{ wrapper: { width: 'min(560px, 100vw)' } }} destroyOnHidden>
      {r.isPending ? <Cargando /> : r.isError ? <Problema error={r.error} /> : <Contenido t={r.data} />}
    </Drawer>
  )
}

function Contenido({ t }: { t: FichaTarea }) {
  const portal = usePortal()
  const pz = usePiezas()
  const { persona, gestiona, trabaja, suspendida } = usePersona()
  const accion = useAccionesDeTarea()
  const [resultado, setResultado] = useState('')
  const [pidiendo, setPidiendo] = useState(false)
  const enTaller = ['received', 'diagnosis', 'waiting_approval', 'in_progress'].includes(t.ot.estado)
  const suya = !t.asignadoId || t.asignadoId === persona?.id || gestiona
  const puedeTrabajar = trabaja && !suspendida && suya && enTaller && t.estado !== 'done'
  const motor = textoMotor(t.ot)
  return (
    <div className="ficha-trabajo">
      <div className="evento-nombre">
        <SituacionTag situacion={t.situacion} detencion={t.detencion} espera={t.espera} faltan={t.faltan} maquinas={t.maquinas} />
        <PlazoTag plazo={t.ot.plazo} />
        {t.ot.prioridad === 'urgent' && <span className="estado rojo">Urgente</span>}
      </div>
      {t.situacion === 'waiting' && <p className="tenue">{textoEspera(t.espera)}</p>}
      {t.maquinas.length > 0 && <Alert type="warning" showIcon title={textoMaquinas(t.maquinas)} description="Se puede empezar cuando vuelva a operar." />}
      {t.faltan.length > 0 && <Alert type="warning" showIcon title={textoFaltan(t.faltan)} description="No se termina hasta que llegue." />}
      {t.situacion === 'held' && t.detencion && <Alert type="warning" showIcon title={`Detenido: ${t.detencion.nota ?? ''}`} description={<>Desde <Hace iso={t.detencion.desde} />{t.detencion.por ? `, por ${t.detencion.por}` : ''}.</>} />}

      <dl className="ficha">
        <dt>OT</dt>
        <dd>
          <Link to="/c/$portal/ot/$id" params={{ portal, id: t.ot.id }}>{folioOt(t.ot.numero)}</Link> · {t.ot.cliente}
        </dd>
        <dt>Motor</dt>
        <dd>
          {t.ot.motor}
          {t.ot.numeroMotor ? ` · N° ${t.ot.numeroMotor}` : ''}
          {motor ? <small className="tenue"> · {motor}</small> : null}
        </dd>
        {t.ot.equipo && (
          <>
            <dt>Equipo</dt>
            <dd>{t.ot.equipo}</dd>
          </>
        )}
        <dt>Pieza y sección</dt>
        <dd>
          {t.pieza === 'motor' ? 'Toda la OT' : pz.nombre(t.pieza)} · {t.seccion}
        </dd>
        <dt>Horas estándar</dt>
        <dd>{t.horas ? horas(t.horas) : '—'}</dd>
        <dt>Lo tiene</dt>
        <dd>{t.asignado ?? <span className="tenue">Sin asignar</span>}</dd>
        <dt>Entrega</dt>
        <dd>{t.ot.entrega ? fecha(`${t.ot.entrega}T12:00:00Z`) : '—'}</dd>
        {t.ot.falla && (
          <>
            <dt>Falla que trajo</dt>
            <dd>{t.ot.falla}</dd>
          </>
        )}
      </dl>

      <Indicaciones t={t} editable={gestiona && !suspendida && t.estado !== 'done'} />

      <Bloque titulo="Lo que ya se hizo en esta pieza">
        {t.anteriores.length ? (
          <ol className="lista-hecho">
            {t.anteriores.map((a) => (
              <li key={a.id}>
                <b>{a.nombre}</b>
                {a.resultado ? <div>{a.resultado}</div> : <div className="tenue">Sin anotaciones.</div>}
                <small className="tenue">
                  {a.quien ?? '—'}
                  {a.termino ? ` · ${fechaHora(a.termino)}` : ''}
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p className="tenue">Es lo primero que se hace en esta pieza.</p>
        )}
      </Bloque>

      <Bloque titulo="Repuestos que espera" extra={puedeTrabajar && !pidiendo ? <Button size="small" onClick={() => setPidiendo(true)}>Pedir un repuesto</Button> : null}>
        {pidiendo && <PedirRepuesto id={t.id} cerrar={() => setPidiendo(false)} />}
        {t.repuestos.length ? (
          <ul className="lista-hecho">
            {t.repuestos.map((x) => (
              <li key={x.id}>
                <span className="evento-nombre">
                  <span>
                    {x.cantidad} × {x.descripcion}
                    {x.medida ? ` · ${x.medida}` : ''}
                  </span>
                  <EstadoRepuestoTag compra={x.compra} estado={x.estado} />
                </span>
                {(x.marca || x.codigo) && <small className="tenue">{[x.marca, x.codigo].filter(Boolean).join(' · ')}</small>}
              </li>
            ))}
          </ul>
        ) : (
          !pidiendo && <p className="tenue">No espera repuestos.</p>
        )}
      </Bloque>

      {t.estado === 'done' ? (
        <Bloque titulo="Lo que anotó al terminar">
          {t.resultado ? <p style={{ margin: 0 }}>{t.resultado}</p> : <p className="tenue">Sin anotaciones.</p>}
          <small className="tenue">{t.termino ? `Terminado ${fechaHora(t.termino)}` : ''}</small>
        </Bloque>
      ) : (
        puedeTrabajar && (
          <div className="ficha-acciones">
            {t.situacion === 'in_progress' && (
              <Input.TextArea rows={2} value={resultado} onChange={(e) => setResultado(e.target.value)} placeholder="Al terminar: la medida final o lo que encontraste (opcional)" maxLength={1000} />
            )}
            <BotonesDeTarea t={t} yo={persona?.id} gestiona={gestiona} trabaja accion={accion} resultado={resultado} />
          </div>
        )
      )}
    </div>
  )
}

/** Lo que el jefe de taller le indica a quien lo hace. El jefe lo escribe o lo corrige; el técnico lo lee. */
function Indicaciones({ t, editable }: { t: FichaTarea; editable: boolean }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(t.indicaciones ?? '')
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const guardar = useMutation({
    mutationFn: () => api('POST', `/servicio/tareas/${t.id}/indicaciones`, { texto }),
    onSuccess: async () => {
      message.success('Indicaciones guardadas.')
      setEditando(false)
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
  return (
    <Bloque titulo="Indicaciones del jefe de taller" extra={editable && !editando ? <Button size="small" type="link" onClick={() => setEditando(true)}>{t.indicaciones ? 'Corregir' : 'Escribir'}</Button> : null}>
      {editando ? (
        <div className="ficha-acciones">
          <Input.TextArea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Rectificar a 0,50; ojo con el muñón 3" maxLength={1000} autoFocus />
          <span className="botones-tarea">
            <Button size="small" onClick={() => setEditando(false)}>Cancelar</Button>
            <Button size="small" type="primary" loading={guardar.isPending} onClick={() => guardar.mutate()}>Guardar</Button>
          </span>
        </div>
      ) : t.indicaciones ? (
        <p className="indicaciones">{t.indicaciones}</p>
      ) : (
        <p className="tenue">Sin indicaciones: se hace como dice la actividad.</p>
      )}
    </Bloque>
  )
}

type DatosRepuesto = { descripcion: string; cantidad: number; medida?: string }

/** Pedir un repuesto que falta: queda por pedir en compras y este trabajo lo espera. */
function PedirRepuesto({ id, cerrar }: { id: string; cerrar: () => void }) {
  const [form] = Form.useForm<DatosRepuesto>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const pedir = useMutation({
    mutationFn: (v: DatosRepuesto) => api('POST', `/servicio/tareas/${id}/repuestos`, v),
    onSuccess: async () => {
      message.success('Pedido: quedó por pedir en compras, y este trabajo lo espera.')
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  return (
    <Form form={form} layout="vertical" requiredMark={false} initialValues={{ cantidad: 1 }} onFinish={(v) => pedir.mutate(v)} className="pedir-repuesto">
      {pedir.isError && <Alert type="error" showIcon title={(pedir.error as Error).message} style={{ marginBottom: 10 }} />}
      <Form.Item label="Qué falta" name="descripcion" rules={[{ required: true, message: 'Escribe qué repuesto falta.' }, { min: 2 }]}>
        <Input placeholder="Válvula de escape" autoFocus />
      </Form.Item>
      <div className="columnas">
        <Form.Item label="Cantidad" name="cantidad" rules={[{ required: true, message: 'Escribe la cantidad.' }]}>
          <InputNumber min={1} max={10_000} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Medida (opcional)" name="medida">
          <Input placeholder="STD, 0,25, 0,50…" />
        </Form.Item>
      </div>
      <span className="botones-tarea">
        <Button size="small" onClick={cerrar}>Cancelar</Button>
        <Button size="small" type="primary" htmlType="submit" loading={pedir.isPending}>Pedir</Button>
      </span>
    </Form>
  )
}
