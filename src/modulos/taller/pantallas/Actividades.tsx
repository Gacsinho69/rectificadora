// Las actividades de la rectificadora, por pieza: qué se le hace a cada pieza, cómo se cuenta al cotizar (por cilindro,
// válvula, biela, culata o una vez), cuánto vale cada unidad, en qué paso de la ruta de su pieza va y quién la hace.
// Con esto se cotiza, se arma la ruta de cada pieza en el taller y se reparte el trabajo entre sus especialistas.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Form, Input, InputNumber, Modal, Select, Switch, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Problema } from '../../../pantallas/componentes'
import { plata } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { cantidadSegun, type Criterio, CRITERIOS, type Motor, PIEZAS, PIEZAS_SUELTAS, type Pieza, unidadDe } from '../reglas'
import { horas, usePersona } from './comun'
import { Secciones } from './Secciones'
import type { Actividad, Catalogo, Persona } from './tipos'

const GRUPOS: Pieza[] = ['motor', ...PIEZAS_SUELTAS]
/** El motor del ejemplo, para mostrar cómo se cuenta cada criterio. */
const EJEMPLO: Motor = { cilindros: 6, valvulasPorCilindro: 4, culatas: 1 }

export function Actividades() {
  const { esAdmin, gestiona, veMontos, suspendida } = usePersona()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const [editar, setEditar] = useState<Actividad | 'nueva' | null>(null)
  const [secciones, setSecciones] = useState(false)
  const r = useQuery({ queryKey: ['taller', 'catalogo'], queryFn: () => api<Catalogo>('GET', '/servicio/catalogo') })
  const personas = useQuery({ queryKey: ['taller', 'personas'], queryFn: () => api<Persona[]>('GET', '/servicio/personas') })
  const hacen = useMutation({
    mutationFn: ({ id, usuarios }: { id: string; usuarios: string[] }) => api('POST', `/servicio/catalogo/${id}/especialistas`, { usuarios }),
    onSuccess: () => {
      message.success('Guardado: los trabajos nuevos de esta actividad se reparten entre ellos.')
      return consultas.invalidateQueries({ queryKey: ['taller'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const seccion = (id: string) => r.data.secciones.find((s) => s.id === id)?.nombre ?? '—'
  const nombre = (id: string) => personas.data?.find((p) => p.id === id)?.nombre ?? '…'
  const puedeAsignar = gestiona && !suspendida
  const puedeEditar = esAdmin && !suspendida
  return (
    <>
      <Encabezado
        titulo="Actividades"
        sub="Por pieza, en el orden de su ruta, con su valor y quién las hace."
        acciones={
          puedeEditar ? (
            <>
              <Button onClick={() => setSecciones(true)}>Secciones</Button>
              <Button type="primary" onClick={() => setEditar('nueva')}>Nueva actividad</Button>
            </>
          ) : null
        }
      />
      <p className="ayuda">
        Cada actividad es de una pieza y va en un paso de su ruta: el taller la hace después de las de paso menor. Al cotizar se cuenta con los datos del motor (por
        cilindro, válvula, biela o culata), y al aprobarse va sola a uno de quienes la hacen: al que ya tiene esa pieza o, si no, al que tiene menos horas pendientes.
        {!esAdmin && ' Los valores y las actividades los cambia el administrador; quién las hace, también el jefe de taller.'}
      </p>
      {GRUPOS.map((p) => {
        const lista = r.data.trabajos.filter((t) => t.pieza === p).sort((a, b) => a.paso - b.paso || a.codigo.localeCompare(b.codigo))
        if (!lista.length) return null
        return (
          <Bloque key={p} titulo={PIEZAS[p]} extra={<span className="tenue">{p === 'motor' ? 'Lo de toda la OT: el desarme antes de las piezas; el armado y el control, después' : `${lista.length} actividades`}</span>}>
            <Table<Actividad>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={lista}
              scroll={{ x: 1040 }}
              columns={[
                { title: 'Paso', dataIndex: 'paso', width: 56, align: 'right', render: (v: number) => <span className="tenue">{v}</span> },
                {
                  title: 'Actividad',
                  key: 'n',
                  render: (_, t) => (
                    <div className="fila-nombre">
                      <b className={t.activo ? undefined : 'tenue'}>
                        {t.nombre}
                        {t.activo ? '' : ' (no se ofrece)'}
                      </b>
                      <small>
                        {t.codigo} · {seccion(t.seccionId)}
                      </small>
                    </div>
                  ),
                },
                { title: 'Cómo se cuenta', dataIndex: 'criterio', width: 118, render: (c: Criterio) => CRITERIOS[c] },
                ...(veMontos
                  ? [
                      {
                        title: 'Valor por unidad',
                        key: 'v',
                        width: 170,
                        align: 'right' as const,
                        render: (_: unknown, t: Actividad) =>
                          t.precio ? (
                            <span>
                              {plata(t.precio)} <small className="tenue">por {t.unidad}</small>
                            </span>
                          ) : (
                            <span className="tenue">A mano</span>
                          ),
                      },
                    ]
                  : []),
                { title: 'Horas por unidad', dataIndex: 'horas', width: 92, align: 'right', render: (v: number) => (v ? horas(v) : '—') },
                {
                  title: 'La hacen',
                  key: 'e',
                  width: 270,
                  render: (_, t) =>
                    puedeAsignar ? (
                      <Select
                        mode="multiple"
                        size="small"
                        allowClear
                        maxTagCount="responsive"
                        placeholder="Nadie todavía"
                        style={{ width: 250 }}
                        value={t.especialistas}
                        loading={personas.isPending}
                        optionFilterProp="label"
                        options={personas.data?.map((x) => ({ value: x.id, label: x.nombre }))}
                        onChange={(usuarios) => hacen.mutate({ id: t.id, usuarios })}
                      />
                    ) : t.especialistas.length ? (
                      t.especialistas.map(nombre).join(', ')
                    ) : (
                      <span className="tenue">Nadie todavía</span>
                    ),
                },
                { title: 'Desglose', dataIndex: 'tipico', width: 76, render: (v: boolean) => (v ? 'Sí' : <span className="tenue">No</span>) },
                ...(puedeEditar ? [{ title: '', key: 'x', width: 1, render: (_: unknown, t: Actividad) => <Button size="small" onClick={() => setEditar(t)}>Editar</Button> }] : []),
              ]}
            />
          </Bloque>
        )
      })}
      {editar && <EditarActividad actividad={editar === 'nueva' ? null : editar} catalogo={r.data} cerrar={() => setEditar(null)} />}
      {secciones && <Secciones catalogo={r.data} cerrar={() => setSecciones(false)} />}
    </>
  )
}

type DatosActividad = { nombre: string; seccionId: string; pieza: Pieza; criterio: Criterio; precio: number | null; horas: number; paso?: number | null; tipico: boolean; activo?: boolean }

/** Crear o ajustar una actividad. El ejemplo dice cómo queda contada en un motor de 6 cilindros. */
function EditarActividad({ actividad, catalogo, cerrar }: { actividad: Actividad | null; catalogo: Catalogo; cerrar: () => void }) {
  const [form] = Form.useForm<DatosActividad>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const criterio = Form.useWatch('criterio', form) ?? actividad?.criterio ?? 'fixed'
  const pieza = Form.useWatch('pieza', form) ?? actividad?.pieza ?? 'culata'
  const precio = Form.useWatch('precio', form)
  const guardar = useMutation({
    mutationFn: (v: DatosActividad) => {
      const datos = { ...v, precio: v.precio ?? null, paso: v.paso ?? undefined }
      return actividad ? api('POST', `/servicio/catalogo/${actividad.id}`, datos) : api<{ codigo: string }>('POST', '/servicio/catalogo', datos)
    },
    onSuccess: async (r) => {
      message.success(actividad ? 'Actividad guardada.' : `Actividad ${(r as { codigo: string }).codigo} creada.`)
      cerrar()
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
  })
  const veces = cantidadSegun(criterio, EJEMPLO)
  const unidad = unidadDe(criterio, pieza)
  return (
    <Modal
      open
      title={actividad ? `Editar ${actividad.codigo} · ${actividad.nombre}` : 'Nueva actividad'}
      okText="Guardar"
      cancelText="Cancelar"
      onCancel={cerrar}
      confirmLoading={guardar.isPending}
      onOk={() => form.validateFields().then((v) => guardar.mutate(v))}
      destroyOnHidden
      width={640}
    >
      {guardar.isError && <Alert type="error" showIcon title={(guardar.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={
          actividad
            ? { nombre: actividad.nombre, seccionId: actividad.seccionId, pieza: actividad.pieza, criterio: actividad.criterio, precio: actividad.precio, horas: actividad.horas, paso: actividad.paso, tipico: actividad.tipico, activo: actividad.activo }
            : { pieza: 'culata', criterio: 'per_cylinder', horas: 1, tipico: false, precio: null }
        }
      >
        <Form.Item label="Nombre" name="nombre" rules={[{ required: true, message: 'Escribe el nombre de la actividad.' }, { min: 3 }]}>
          <Input placeholder="Prueba hidráulica de culata" />
        </Form.Item>
        <div className="columnas">
          <Form.Item label="Pieza" name="pieza">
            <Select options={GRUPOS.map((p) => ({ value: p, label: p === 'motor' ? 'Motor completo (toda la OT)' : PIEZAS[p] }))} />
          </Form.Item>
          <Form.Item label="Sección donde se hace" name="seccionId" rules={[{ required: true, message: 'Elige la sección.' }]}>
            <Select options={catalogo.secciones.filter((s) => s.activa).map((s) => ({ value: s.id, label: s.nombre }))} />
          </Form.Item>
        </div>
        <div className="columnas-3">
          <Form.Item label="Cómo se cuenta" name="criterio">
            <Select options={Object.entries(CRITERIOS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label={`Valor por ${unidad} (sin IVA)`} name="precio" extra="Vacío: se escribe al cotizar.">
            <InputNumber min={0} step={1000} style={{ width: '100%' }} placeholder="A mano" />
          </Form.Item>
          <Form.Item label={`Horas por ${unidad}`} name="horas" rules={[{ required: true, message: 'Escribe las horas.' }]}>
            <InputNumber min={0} max={1000} step={0.25} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          title={
            criterio === 'fixed'
              ? `Va una vez por OT${precio ? `: ${plata(precio)}` : ''}.`
              : `En un motor de 6 cilindros, con 4 válvulas por cilindro y 1 culata, va ${veces} ${veces === 1 ? 'vez' : 'veces'}${precio ? `: ${plata(veces * precio)}` : ''}.`
          }
        />
        <div className="columnas">
          <Form.Item label="Paso en la ruta de su pieza" name="paso" extra="De menor a mayor; el mismo paso, a la vez. Vacío: va al final.">
            <InputNumber min={0} max={9999} step={10} style={{ width: '100%' }} />
          </Form.Item>
          <div>
            <Form.Item name="tipico" valuePropName="checked" style={{ marginTop: 28, marginBottom: 8 }}>
              <Checkbox>Va en el desglose típico de su pieza</Checkbox>
            </Form.Item>
            {actividad && (
              <Form.Item label="Se ofrece" name="activo" valuePropName="checked" layout="horizontal">
                <Switch size="small" />
              </Form.Item>
            )}
          </div>
        </div>
      </Form>
    </Modal>
  )
}
