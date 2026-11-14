// Lo que se hace con un trabajo, igual en el tablero y en la OT: iniciar y terminar lo que tiene su turno, detenerlo con
// su motivo (faltan repuestos, falta la respuesta del cliente…), reanudarlo, y que el jefe de taller lo adelante.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Form, Input, Modal, Radio } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { type EstadoTarea, MOTIVOS_DETENCION, type MotivoDetencion, type Situacion } from '../reglas'

type Accion = 'iniciar' | 'terminar' | 'asignar' | 'detener' | 'reanudar' | 'adelantar'

const AVISOS: Partial<Record<Accion, string>> = { detener: 'Trabajo detenido: sale de la cola hasta reanudarlo.', reanudar: 'Trabajo reanudado.', adelantar: 'Adelantado: ya se puede empezar.' }

/** Las acciones sobre un trabajo. Al asignar, lo que sigue de la misma pieza en la sección pasa a la misma persona. */
export function useAccionesDeTarea() {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  return useMutation({
    mutationFn: ({ id, accion, datos }: { id: string; accion: Accion; datos?: unknown }) => api<{ ok: true; tambien?: number }>('POST', `/servicio/tareas/${id}/${accion}`, datos ?? {}),
    onSuccess: (r, { accion }) => {
      if (accion === 'asignar' && r.tambien) message.success(`Asignado, con lo que sigue de esa pieza (${r.tambien} ${r.tambien === 1 ? 'trabajo más' : 'trabajos más'}).`)
      else if (AVISOS[accion]) message.success(AVISOS[accion])
      return consultas.invalidateQueries({ queryKey: ['taller'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
}

type Props = {
  t: { id: string; estado: EstadoTarea; situacion: Situacion; asignadoId: string | null; faltan?: string[] }
  yo?: string
  gestiona: boolean
  trabaja: boolean
  accion: ReturnType<typeof useAccionesDeTarea>
  /** Lo que anotó quien lo hizo, para guardarlo al terminar (desde la ficha). */
  resultado?: string
}

/** Los botones que corresponden a la situación del trabajo y a quién mira. */
export function BotonesDeTarea({ t, yo, gestiona, trabaja, accion, resultado }: Props) {
  const [deteniendo, setDeteniendo] = useState(false)
  if (!trabaja || t.situacion === 'done') return null
  const suya = !t.asignadoId || t.asignadoId === yo || gestiona
  if (!suya) return null
  const cargando = (a: Accion) => accion.isPending && accion.variables?.id === t.id && accion.variables.accion === a
  const hacer = (a: Accion) => (e: React.MouseEvent) => {
    e.stopPropagation()
    accion.mutate({ id: t.id, accion: a })
  }
  const detener = (
    <Button size="small" type="text" onClick={(e) => { e.stopPropagation(); setDeteniendo(true) }}>
      Detener
    </Button>
  )
  return (
    // Dentro de una tarjeta o fila que abre la ficha: un clic aquí (o en el diálogo de detener) no la abre.
    <span className="botones-tarea" onClick={(e) => e.stopPropagation()}>
      {t.situacion === 'available' && (
        <>
          {detener}
          <Button size="small" loading={cargando('iniciar')} onClick={hacer('iniciar')}>Iniciar</Button>
        </>
      )}
      {t.situacion === 'in_progress' && (
        <>
          {detener}
          <Button
            size="small"
            type="primary"
            loading={cargando('terminar')}
            disabled={Boolean(t.faltan?.length)}
            title={t.faltan?.length ? `Falta que llegue: ${t.faltan.join(', ')}` : undefined}
            onClick={(e) => {
              e.stopPropagation()
              accion.mutate({ id: t.id, accion: 'terminar', datos: { resultado: resultado || undefined } })
            }}
          >
            Terminar
          </Button>
        </>
      )}
      {t.situacion === 'waiting' && gestiona && <Button size="small" loading={cargando('adelantar')} onClick={hacer('adelantar')} title="Dejar empezarlo antes de que termine lo anterior de su pieza">Adelantar</Button>}
      {t.situacion === 'held' && <Button size="small" loading={cargando('reanudar')} onClick={hacer('reanudar')}>Reanudar</Button>}
      {deteniendo && <Detener id={t.id} accion={accion} cerrar={() => setDeteniendo(false)} />}
    </span>
  )
}

function Detener({ id, accion, cerrar }: { id: string; accion: ReturnType<typeof useAccionesDeTarea>; cerrar: () => void }) {
  const [form] = Form.useForm<{ motivo: MotivoDetencion; nota?: string }>()
  const motivo = Form.useWatch('motivo', form)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      open
      title="Detener el trabajo"
      okText="Detener"
      cancelText="Cancelar"
      onCancel={cerrar}
      confirmLoading={accion.isPending}
      destroyOnHidden
      onOk={() =>
        form.validateFields().then((v) =>
          accion.mutate({ id, accion: 'detener', datos: v }, { onSuccess: cerrar, onError: (e) => setError((e as Error).message) }),
        )
      }
    >
      <div onClick={(e) => e.stopPropagation()}>
        {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} />}
        <p className="tenue" style={{ marginTop: 0 }}>Sale de la cola de lo que se puede hacer y queda a la vista con su motivo hasta reanudarlo.</p>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ motivo: 'parts' }}>
          <Form.Item label="Por qué" name="motivo">
            <Radio.Group options={Object.entries(MOTIVOS_DETENCION).map(([value, label]) => ({ value, label }))} style={{ display: 'flex', flexDirection: 'column', gap: 6 }} />
          </Form.Item>
          <Form.Item
            label={motivo === 'parts' ? 'Qué falta (opcional)' : motivo === 'other' ? 'Qué pasa' : 'Nota (opcional)'}
            name="nota"
            rules={motivo === 'other' ? [{ required: true, message: 'Escribe por qué se detiene.' }, { min: 3 }] : []}
          >
            <Input.TextArea rows={2} placeholder={motivo === 'parts' ? 'Pistones 0,50; llegan el jueves' : undefined} />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  )
}
