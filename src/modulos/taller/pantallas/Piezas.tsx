// Las piezas del taller: las de siempre (motor, culata, block…) y las propias que agrega el administrador (un turbo,
// una bomba inyectora). Una propia se renombra o se deja de usar; no se borra, porque las OT que la tienen la nombran.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Input, Modal, Switch, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { plural } from '../../../pantallas/formato'
import { nombreDePieza, PIEZAS, type Pieza, type PiezaPropia, piezasSueltas } from '../reglas'
import type { Catalogo } from './tipos'

/** Las piezas de la rectificadora con su nombre. Mientras cargan, las propias se nombran «Pieza». */
export function usePiezas() {
  const q = useQuery({ queryKey: ['taller', 'piezas'], queryFn: () => api<{ propias: PiezaPropia[] }>('GET', '/servicio/piezas'), staleTime: 5 * 60_000 })
  const propias = q.data?.propias ?? []
  const sueltas = piezasSueltas(propias)
  return {
    propias,
    nombre: (p: Pieza) => nombreDePieza(p, propias),
    /** Las sueltas que se ofrecen (las propias en uso), en orden. */
    sueltas,
    /** Para agrupar lo que ya existe: también las propias que ya no se usan. */
    sueltasConInactivas: piezasSueltas(propias, true),
    /** Para elegir al recibir: el motor completo y las sueltas en uso. */
    opciones: (['motor', ...sueltas] as Pieza[]).map((p) => ({ value: p, label: nombreDePieza(p, propias) })),
  }
}

export function PiezasDelTaller({ catalogo, cerrar }: { catalogo: Catalogo; cerrar: () => void }) {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const { propias } = usePiezas()
  const [nueva, setNueva] = useState('')
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const accion = useMutation({
    mutationFn: ({ ruta, datos }: { ruta: string; datos: unknown; aviso?: string }) => api('POST', `/servicio/piezas${ruta}`, datos),
    onSuccess: async (_, { aviso }) => {
      if (aviso) message.success(aviso)
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  const actividades = (p: PiezaPropia) => catalogo.trabajos.filter((t) => t.pieza === p.id && t.activo).length
  const renombrar = (p: PiezaPropia) => {
    const nombre = (nombres[p.id] ?? p.nombre).trim()
    if (nombre && nombre !== p.nombre) accion.mutate({ ruta: `/${p.id}`, datos: { nombre }, aviso: 'Pieza renombrada.' })
  }
  const agregar = () => accion.mutate({ ruta: '', datos: { nombre: nueva.trim() }, aviso: 'Pieza agregada. Ahora dale sus actividades.' }, { onSuccess: () => setNueva('') })
  return (
    <Modal open title="Piezas del taller" footer={<Button onClick={cerrar}>Cerrar</Button>} onCancel={cerrar} destroyOnHidden width={640}>
      <p className="tenue" style={{ marginTop: 0 }}>
        Las de siempre: {Object.values(PIEZAS).join(', ')}. Agrega las que también trabajas (un turbo, una bomba inyectora): salen al recibir, en las actividades y en la cotización, y en el taller van por su cuenta, como cualquier pieza suelta.
      </p>
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} closable onClose={() => accion.reset()} />}
      {propias.length > 0 && (
        <Table<PiezaPropia>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={propias}
          rowClassName={(p) => (p.activa ? '' : 'fila-inactiva')}
          columns={[
            {
              title: 'Pieza propia',
              key: 'n',
              render: (_, p) => (
                <div className="fila-nombre">
                  <Input size="small" value={nombres[p.id] ?? p.nombre} onChange={(e) => setNombres({ ...nombres, [p.id]: e.target.value })} onBlur={() => renombrar(p)} onPressEnter={() => renombrar(p)} aria-label={`Nombre de ${p.nombre}`} />
                  <small>{plural(actividades(p), 'actividad', 'actividades')}</small>
                </div>
              ),
            },
            {
              title: 'En uso',
              key: 'a',
              width: 70,
              align: 'center',
              render: (_, p) => <Switch size="small" checked={p.activa} aria-label={`En uso: ${p.nombre}`} onChange={(v) => accion.mutate({ ruta: `/${p.id}`, datos: { activa: v }, aviso: v ? 'Pieza en uso.' : 'Pieza fuera de uso: ya no se ofrece al recibir.' })} />,
            },
          ]}
        />
      )}
      <div className="nueva-seccion">
        <Input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Turbo" maxLength={40} onPressEnter={() => nueva.trim().length >= 2 && agregar()} />
        <Button type="primary" disabled={nueva.trim().length < 2} loading={accion.isPending && accion.variables?.ruta === ''} onClick={agregar}>
          Agregar pieza
        </Button>
      </div>
    </Modal>
  )
}
