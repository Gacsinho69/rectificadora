// Las secciones del taller, en el orden de las columnas del tablero: el administrador agrega las suyas (bombas
// inyectoras, turbos), las renombra, las ordena y apaga las que ya no usa. Una sección se apaga cuando no le quedan
// actividades en uso ni trabajos por hacer; la de recepción y diagnóstico no se apaga.
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Input, Modal, Switch, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { plural } from '../../../pantallas/formato'
import type { Catalogo } from './tipos'

type Seccion = Catalogo['secciones'][number]

export function Secciones({ catalogo, cerrar }: { catalogo: Catalogo; cerrar: () => void }) {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [nueva, setNueva] = useState('')
  const [nombres, setNombres] = useState<Record<string, string>>({})
  const accion = useMutation({
    mutationFn: ({ ruta, datos }: { ruta: string; datos: unknown; aviso?: string }) => api('POST', `/servicio/secciones${ruta}`, datos),
    onSuccess: async (_, { aviso }) => {
      if (aviso) message.success(aviso)
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  const actividades = (s: Seccion) => catalogo.trabajos.filter((t) => t.seccionId === s.id && t.activo).length
  const renombrar = (s: Seccion) => {
    const nombre = (nombres[s.id] ?? s.nombre).trim()
    // Lo escrito se descarta al salir: la casilla vuelve a mostrar lo guardado (el nombre nuevo, o el de antes si quedó
    // vacía), y no se pisa después lo que otro cambió.
    const { [s.id]: _, ...resto } = nombres
    setNombres(resto)
    if (nombre && nombre !== s.nombre) accion.mutate({ ruta: `/${s.id}`, datos: { nombre }, aviso: 'Sección renombrada.' })
  }
  return (
    <Modal open title="Secciones del taller" footer={<Button onClick={cerrar}>Cerrar</Button>} onCancel={cerrar} destroyOnHidden width={640}>
      <p className="tenue" style={{ marginTop: 0 }}>En este orden salen las secciones en el tablero. Una sección se apaga cuando ya no tiene actividades en uso ni trabajos por hacer.</p>
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} closable onClose={() => accion.reset()} />}
      <Table<Seccion>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={catalogo.secciones}
        rowClassName={(s) => (s.activa ? '' : 'fila-inactiva')}
        columns={[
          {
            title: 'Sección',
            key: 'n',
            render: (_, s) => (
              <div className="fila-nombre">
                <Input size="small" value={nombres[s.id] ?? s.nombre} onChange={(e) => setNombres({ ...nombres, [s.id]: e.target.value })} onBlur={() => renombrar(s)} onPressEnter={() => renombrar(s)} aria-label={`Nombre de ${s.nombre}`} />
                <small>{s.diagnostico ? 'Recepción: ahí nace cada OT' : plural(actividades(s), 'actividad', 'actividades')}</small>
              </div>
            ),
          },
          {
            title: '',
            key: 'o',
            width: 80,
            render: (_, s, i) => (
              <span className="botones-tarea">
                <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={i === 0} aria-label="Subir" onClick={() => accion.mutate({ ruta: `/${s.id}/mover`, datos: { hacia: 'arriba' } })} />
                <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={i === catalogo.secciones.length - 1} aria-label="Bajar" onClick={() => accion.mutate({ ruta: `/${s.id}/mover`, datos: { hacia: 'abajo' } })} />
              </span>
            ),
          },
          {
            title: 'En uso',
            key: 'a',
            width: 70,
            align: 'center',
            render: (_, s) => <Switch size="small" checked={s.activa} disabled={s.diagnostico} aria-label={`En uso: ${s.nombre}`} onChange={(v) => accion.mutate({ ruta: `/${s.id}`, datos: { activa: v }, aviso: v ? 'Sección en uso.' : 'Sección apagada: sale del tablero.' })} />,
          },
        ]}
      />
      <div className="nueva-seccion">
        <Input value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Bombas inyectoras" onPressEnter={() => nueva.trim() && accion.mutate({ ruta: '', datos: { nombre: nueva.trim() }, aviso: 'Sección agregada al final.' }, { onSuccess: () => setNueva('') })} />
        <Button type="primary" disabled={nueva.trim().length < 2} loading={accion.isPending && accion.variables?.ruta === ''} onClick={() => accion.mutate({ ruta: '', datos: { nombre: nueva.trim() }, aviso: 'Sección agregada al final.' }, { onSuccess: () => setNueva('') })}>
          Agregar sección
        </Button>
      </div>
    </Modal>
  )
}
