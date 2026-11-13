// Dar de alta una rectificadora desde la consola: su nombre y subdominio, el plan y si parte en prueba, con qué taller
// nace (la plantilla: secciones y actividades) y su primer administrador. Queda en la auditoría con su motivo; desde
// ahí, su administrador suma a su gente.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Alert, App, Form, Input, InputNumber, Modal, Radio, Select } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { type Invitacion, ModalEnlace } from '../../../pantallas/componentes'
import { plata, plural } from '../../../pantallas/formato'
import { PLANTILLAS_TALLER, type PlantillaTaller } from '../../taller/reglas'
import { faltaDelSubdominio, PLANES, type Plan, REGIONES, type Region, subdominioDe } from '../../tenants/reglas'
import { CamposDePersona } from './vistas'

type Datos = {
  nombre: string
  subdominio: string
  region: Region
  plan: Plan
  estado: 'trial' | 'active'
  diasPrueba: number
  mrr?: number | null
  correoFacturacion: string
  plantilla: PlantillaTaller
  administrador: { nombre: string; correo: string }
  motivo: string
}

const INICIAL: Partial<Datos> = { region: 'sa-1', plan: 'starter', estado: 'trial', diasPrueba: 14, plantilla: 'completa' }

export function NuevoCliente({ cerrar }: { cerrar: () => void }) {
  const [form] = Form.useForm<Datos>()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const ir = useNavigate()
  // Mientras no se toque a mano, el subdominio sigue al nombre.
  const [subdominioPropio, setSubdominioPropio] = useState(false)
  const opciones = useQuery({ queryKey: ['opciones'], queryFn: () => api<{ dominio: string }>('GET', '/plataforma/opciones') })
  const estado = Form.useWatch('estado', form)
  const plan = Form.useWatch('plan', form)
  // Creada, se muestra el enlace de su administrador; al cerrarlo, se va a su ficha.
  const [creada, setCreada] = useState<{ id: string; administrador: string; invitacion: Invitacion } | null>(null)
  const crear = useMutation({
    mutationFn: (v: Datos) => api<{ id: string; invitacion: Invitacion }>('POST', '/plataforma/tenants', { ...v, mrr: v.mrr ?? null }),
    onSuccess: async (r, v) => {
      message.success('Rectificadora creada.')
      await Promise.all(['tenants', 'resumen', 'opciones', 'alertas'].map((k) => consultas.invalidateQueries({ queryKey: [k] })))
      setCreada({ id: r.id, administrador: v.administrador.nombre, invitacion: r.invitacion })
    },
  })
  if (creada)
    return (
      <ModalEnlace
        nombre={creada.administrador}
        invitacion={creada.invitacion}
        cerrar={() => {
          cerrar()
          ir({ to: '/plataforma/clientes/$id', params: { id: creada.id } })
        }}
      >
        <p>Es su administrador: al entrar, suma a su gente desde «Administración».</p>
      </ModalEnlace>
    )
  return (
    <Modal open title="Nueva rectificadora" okText="Dar de alta" cancelText="Cancelar" onCancel={() => !crear.isPending && cerrar()} confirmLoading={crear.isPending} onOk={() => form.validateFields().then((v) => crear.mutate(v))} destroyOnHidden width={680}>
      {crear.isError && <Alert type="error" showIcon title={(crear.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={INICIAL}
        onValuesChange={(cambio: Partial<Datos>) => {
          if (cambio.nombre !== undefined && !subdominioPropio) form.setFieldValue('subdominio', subdominioDe(cambio.nombre))
          if (cambio.subdominio !== undefined) setSubdominioPropio(true)
        }}
      >
        <div className="columnas">
          <Form.Item label="Nombre de la rectificadora" name="nombre" rules={[{ required: true, message: 'Escribe el nombre.' }, { min: 3, message: 'Escribe el nombre.' }]}>
            <Input placeholder="Rectificadora Ñuble" />
          </Form.Item>
          <Form.Item
            label="Subdominio"
            name="subdominio"
            extra={opciones.data ? `Su sistema queda en ese subdominio de ${opciones.data.dominio}.` : undefined}
            rules={[{ required: true, message: 'Escribe el subdominio.' }, { validator: (_, v?: string) => (!v || !faltaDelSubdominio(v) ? Promise.resolve() : Promise.reject(new Error(faltaDelSubdominio(v)!))) }]}
          >
            {/* El sufijo va siempre (vacío mientras llega el dominio): si aparece después, el campo pierde el foco. */}
            <Input placeholder="nuble" suffix={<span className="tenue">{opciones.data ? `.${opciones.data.dominio}` : ''}</span>} />
          </Form.Item>
        </div>

        <p className="form-seccion">Plan</p>
        <div className="columnas">
          <Form.Item label="Plan" name="plan">
            <Select options={(Object.keys(PLANES) as Plan[]).map((p) => ({ value: p, label: `${PLANES[p].nombre} · ${PLANES[p].precio ? `${plata(PLANES[p].precio)}/mes` : 'sin costo'} · ${PLANES[p].limites.users} usuarios` }))} />
          </Form.Item>
          <Form.Item label="Región" name="region">
            <Select options={Object.entries(REGIONES).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="Parte" name="estado">
            <Radio.Group options={[{ value: 'trial', label: 'En prueba' }, { value: 'active', label: 'Activa, ya contratada' }]} />
          </Form.Item>
          {estado === 'trial' ? (
            <Form.Item label="Días de prueba" name="diasPrueba" rules={[{ required: true, message: 'Escribe los días de prueba.' }]} extra="En prueba no paga; al terminar, se activa o se suspende desde su ficha.">
              <InputNumber min={1} max={90} style={{ width: '100%' }} />
            </Form.Item>
          ) : (
            <Form.Item label="Precio mensual (opcional)" name="mrr" extra={plan ? `Vacío: el de lista, ${plata(PLANES[plan].precio)}.` : undefined}>
              <InputNumber min={0} step={10_000} style={{ width: '100%' }} prefix="$" />
            </Form.Item>
          )}
        </div>
        <Form.Item label="Correo de facturación" name="correoFacturacion" rules={[{ required: true, message: 'Escribe el correo de facturación.' }, { type: 'email', message: 'El correo no es válido.' }]}>
          <Input placeholder="facturacion@rectificadora.cl" />
        </Form.Item>

        <p className="form-seccion">Con qué taller parte</p>
        <Form.Item name="plantilla" extra="Después ajusta sus valores, agrega sus actividades y apaga las que no hace.">
          <Radio.Group className="lista-opciones">
            {(Object.keys(PLANTILLAS_TALLER) as PlantillaTaller[]).map((clave) => {
              const p = PLANTILLAS_TALLER[clave]
              return (
                <Radio key={clave} value={clave}>
                  <b>{p.nombre}</b>{' '}
                  <span className="tenue">
                    · {plural(p.secciones.length, 'sección', 'secciones')} · {plural(p.codigos.length, 'actividad', 'actividades')}
                  </span>
                  <small className="tenue">{p.detalle}</small>
                </Radio>
              )
            })}
          </Radio.Group>
        </Form.Item>

        <p className="form-seccion">Su administrador</p>
        <CamposDePersona prefijo="administrador" conRol={false} />

        <Form.Item label="Motivo" name="motivo" rules={[{ required: true, message: 'Escribe el motivo.' }, { min: 10, message: 'Al menos 10 letras: queda en la auditoría.' }]}>
          <Input.TextArea rows={2} placeholder="Contrato firmado el 13-11, ticket de ventas 512" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
