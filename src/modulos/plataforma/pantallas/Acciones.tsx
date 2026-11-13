// Los diálogos de las acciones del equipo sobre un cliente. Cada uno pide su motivo, que queda en la auditoría; el
// permiso lo revisa el servidor, y aquí solo se avisa antes de intentar.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Alert, App, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { type Invitacion, ModalEnlace } from '../../../pantallas/componentes'
import { megas, plata } from '../../../pantallas/formato'
import { CAMBIOS_DE_ESTADO, ESTADOS_TENANT, FUNCIONES, type Funcion, LIMITES, type Limites, PLANES, type Plan } from '../../tenants/reglas'
import { ROLES_TENANT, type RolTenant } from '../../usuarios/reglas'
import type { DetalleTenant, UsuarioVisible } from './tipos'
import { CamposDePersona } from './vistas'

export type Dialogo =
  | { tipo: 'estado' }
  | { tipo: 'plan' }
  | { tipo: 'limites' }
  | { tipo: 'impersonar' }
  | { tipo: 'funcion'; funcion: Funcion; activa: boolean }
  | { tipo: 'agregar' }
  | { tipo: 'bloqueo'; usuario: UsuarioVisible }
  | { tipo: 'rol'; usuario: UsuarioVisible }
  | { tipo: 'enlace'; usuario: UsuarioVisible }

const MOTIVO = [
  { required: true, message: 'Escribe el motivo.' },
  { min: 10, message: 'Al menos 10 letras: queda en la auditoría.' },
]

function useAccion(tenantId: string, cerrar: () => void, ruta: string, exito: string) {
  const consultas = useQueryClient()
  const { message } = App.useApp()
  return useMutation({
    mutationFn: (datos: unknown) => api<{ ok: true }>('POST', `/plataforma/tenants/${tenantId}${ruta}`, datos),
    onSuccess: async () => {
      message.success(exito)
      cerrar()
      await Promise.all(['tenant', 'tenants', 'resumen', 'alertas'].map((k) => consultas.invalidateQueries({ queryKey: [k] })))
    },
  })
}

export function Acciones({ tenant, dialogo, cerrar }: { tenant: DetalleTenant; dialogo: Dialogo | null; cerrar: () => void }) {
  if (!dialogo) return null
  const props = { tenant, cerrar }
  switch (dialogo.tipo) {
    case 'estado':
      return <CambiarEstado {...props} />
    case 'plan':
      return <CambiarPlan {...props} />
    case 'limites':
      return <AjustarLimites {...props} />
    case 'impersonar':
      return <Impersonar {...props} />
    case 'funcion':
      return <CambiarFuncion {...props} funcion={dialogo.funcion} activa={dialogo.activa} />
    case 'agregar':
      return <AgregarPersona {...props} />
    case 'bloqueo':
      return <Bloquear {...props} usuario={dialogo.usuario} />
    case 'rol':
      return <CambiarRol {...props} usuario={dialogo.usuario} />
    case 'enlace':
      return <EnlaceNuevo {...props} usuario={dialogo.usuario} />
  }
}

type Props = { tenant: DetalleTenant; cerrar: () => void }

type EstadoAccion = { isPending: boolean; isError: boolean; error: unknown }

function Dialogo({ titulo, accion, enviar, cerrar, children, textoOk = 'Confirmar', peligro }: { titulo: string; accion: EstadoAccion; enviar: () => void; cerrar: () => void; children: React.ReactNode; textoOk?: string; peligro?: boolean }) {
  return (
    <Modal open title={titulo} onOk={enviar} onCancel={() => !accion.isPending && cerrar()} okText={textoOk} cancelText="Cancelar" confirmLoading={accion.isPending} okButtonProps={{ danger: peligro }} destroyOnHidden>
      {accion.isError && <Alert type="error" showIcon title={(accion.error as Error).message} style={{ marginBottom: 12 }} />}
      {children}
    </Modal>
  )
}

function CambiarEstado({ tenant, cerrar }: Props) {
  const [form] = Form.useForm<{ estado: keyof typeof ESTADOS_TENANT; motivo: string }>()
  const accion = useAccion(tenant.id, cerrar, '/estado', 'Estado cambiado.')
  const estado = Form.useWatch('estado', form)
  return (
      <Dialogo cerrar={cerrar} titulo={`Cambiar el estado de ${tenant.nombre}`} accion={accion} enviar={() => form.validateFields().then((v) => accion.mutate(v))} peligro={estado === 'suspended' || estado === 'cancelled'}>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item label={`Ahora: ${ESTADOS_TENANT[tenant.estado]}. Pasar a`} name="estado" rules={[{ required: true, message: 'Elige el estado.' }]}>
            <Select options={CAMBIOS_DE_ESTADO[tenant.estado].map((e) => ({ value: e, label: ESTADOS_TENANT[e] }))} />
          </Form.Item>
          {estado === 'suspended' && <Alert type="warning" showIcon title="Sus usuarios podrán mirar, pero no hacer cambios, hasta que se reactive." style={{ marginBottom: 12 }} />}
          {estado === 'cancelled' && <Alert type="warning" showIcon title="Nadie del cliente podrá entrar. Sus datos se conservan." style={{ marginBottom: 12 }} />}
          <Form.Item label="Motivo" name="motivo" rules={MOTIVO}>
            <Input.TextArea rows={3} placeholder="Por qué, para quien lea la auditoría después" />
          </Form.Item>
        </Form>
      </Dialogo>
  )
}

function CambiarPlan({ tenant, cerrar }: Props) {
  const [form] = Form.useForm<{ plan: Plan; mrr?: number; motivo: string }>()
  const accion = useAccion(tenant.id, cerrar, '/plan', 'Plan cambiado.')
  const plan = Form.useWatch('plan', form)
  return (
      <Dialogo cerrar={cerrar} titulo={`Cambiar el plan de ${tenant.nombre}`} accion={accion} enviar={() => form.validateFields().then((v) => accion.mutate({ ...v, mrr: v.mrr ?? undefined }))}>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ plan: tenant.plan }}>
          <Form.Item label={`Ahora: ${PLANES[tenant.plan].nombre} (${plata(tenant.mrr)}/mes)`} name="plan" rules={[{ required: true }]}>
            <Select options={(Object.keys(PLANES) as Plan[]).map((p) => ({ value: p, label: `${PLANES[p].nombre} · ${plata(PLANES[p].precio)}/mes` }))} />
          </Form.Item>
          {plan === 'enterprise' && (
            <Form.Item label="Precio negociado (opcional)" name="mrr" extra="Vacío: el precio de lista.">
              <InputNumber min={0} step={10_000} style={{ width: '100%' }} prefix="$" />
            </Form.Item>
          )}
          {tenant.estado === 'trial' && <p className="tenue">Está en prueba: el monto mensual queda en cero hasta que se active.</p>}
          <Form.Item label="Motivo" name="motivo" rules={MOTIVO}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Dialogo>
  )
}

function AjustarLimites({ tenant, cerrar }: Props) {
  const claves = Object.keys(LIMITES) as (keyof Limites)[]
  const [form] = Form.useForm<Partial<Limites> & { motivo: string }>()
  const accion = useAccion(tenant.id, cerrar, '/limites', 'Límites ajustados.')
  const enviar = () =>
    form.validateFields().then(({ motivo, ...valores }) => {
      // Vacío vuelve al límite del plan.
      const ajustes = Object.fromEntries(claves.map((k) => [k, (valores as Partial<Limites>)[k] ?? null]))
      accion.mutate({ ajustes, motivo })
    })
  return (
      <Dialogo cerrar={cerrar} titulo={`Ajustar los límites de ${tenant.nombre}`} accion={accion} enviar={enviar}>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={tenant.ajustes}>
          {claves.map((k) => (
            <Form.Item key={k} label={LIMITES[k].nombre} name={k} extra={`Plan ${PLANES[tenant.plan].nombre}: ${k === 'storage_mb' ? megas(tenant.limitesDelPlan[k]) : tenant.limitesDelPlan[k].toLocaleString('es-CL')}. Vacío = el del plan.`}>
              <InputNumber min={0} style={{ width: '100%' }} placeholder={String(tenant.limitesDelPlan[k])} />
            </Form.Item>
          ))}
          <Form.Item label="Motivo" name="motivo" rules={MOTIVO}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Dialogo>
  )
}

function CambiarFuncion({ tenant, cerrar, funcion, activa }: Props & { funcion: Funcion; activa: boolean }) {
  const [form] = Form.useForm<{ motivo?: string }>()
  const accion = useAccion(tenant.id, cerrar, '/funciones', activa ? 'Función encendida.' : 'Función apagada.')
  return (
      <Dialogo cerrar={cerrar} titulo={`${activa ? 'Encender' : 'Apagar'} «${FUNCIONES[funcion]}»`} accion={accion} enviar={() => form.validateFields().then((v) => accion.mutate({ funcion, activa, motivo: v.motivo || undefined }))} textoOk={activa ? 'Encender' : 'Apagar'}>
        <Form form={form} layout="vertical">
          <Form.Item label="Motivo (opcional)" name="motivo">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Dialogo>
  )
}

/** Una acción que devuelve un enlace de invitación: en vez de cerrarse, muestra el enlace para mandarlo. */
function useInvitacion(tenantId: string, ruta: string) {
  const consultas = useQueryClient()
  const [invitacion, setInvitacion] = useState<Invitacion | null>(null)
  const accion = useMutation({
    mutationFn: (datos: unknown) => api<Invitacion>('POST', `/plataforma/tenants/${tenantId}${ruta}`, datos),
    onSuccess: async (r) => {
      setInvitacion(r)
      await Promise.all(['tenant', 'tenants', 'resumen'].map((k) => consultas.invalidateQueries({ queryKey: [k] })))
    },
  })
  return { accion, invitacion }
}

/** Agregar a alguien al cliente, dentro del límite de usuarios de su plan. Queda invitado, con su enlace. */
function AgregarPersona({ tenant, cerrar }: Props) {
  const [form] = Form.useForm<{ nombre: string; correo: string; rol: RolTenant; motivo: string }>()
  const { accion, invitacion } = useInvitacion(tenant.id, '/usuarios')
  const cupo = tenant.usos.find((u) => u.clave === 'users')
  if (invitacion) return <ModalEnlace nombre={form.getFieldValue('nombre')} invitacion={invitacion} cerrar={cerrar} />
  return (
    <Dialogo cerrar={cerrar} titulo={`Agregar a alguien a ${tenant.nombre}`} accion={accion} enviar={() => form.validateFields().then((v) => accion.mutate(v))} textoOk="Agregar">
      {cupo && <p className="tenue" style={{ marginTop: 0 }}>Usa {cupo.usado} de {cupo.limite} usuarios de su plan. Si ya no caben, primero se ajusta el límite.</p>}
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ rol: 'admin' }}>
        <CamposDePersona />
        <Form.Item label="Motivo" name="motivo" rules={MOTIVO}>
          <Input.TextArea rows={2} placeholder="El cliente lo pidió por correo: su administrador dejó la empresa" />
        </Form.Item>
      </Form>
    </Dialogo>
  )
}

/** Un enlace nuevo para una invitación pendiente (se le perdió, venció). El anterior deja de servir. */
function EnlaceNuevo({ tenant, cerrar, usuario }: Props & { usuario: UsuarioVisible }) {
  const [form] = Form.useForm<{ motivo: string }>()
  const { accion, invitacion } = useInvitacion(tenant.id, `/usuarios/${usuario.id}/invitacion`)
  if (invitacion) return <ModalEnlace nombre={usuario.nombre} invitacion={invitacion} cerrar={cerrar} />
  return (
    <Dialogo cerrar={cerrar} titulo={`Enlace nuevo para ${usuario.nombre}`} accion={accion} enviar={() => form.validateFields().then((v) => accion.mutate(v))} textoOk="Hacer enlace nuevo">
      <p>Sale un enlace nuevo, que sirve 7 días; el anterior deja de servir. Lo normal es que lo pida su administrador desde su panel.</p>
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="Motivo" name="motivo" rules={MOTIVO}>
          <Input.TextArea rows={2} placeholder="El administrador llamó: se le venció el enlace" />
        </Form.Item>
      </Form>
    </Dialogo>
  )
}

function Bloquear({ tenant, cerrar, usuario }: Props & { usuario: UsuarioVisible }) {
  const bloquear = usuario.estado !== 'blocked'
  const [form] = Form.useForm<{ motivo: string }>()
  const accion = useAccion(tenant.id, cerrar, `/usuarios/${usuario.id}/bloqueo`, bloquear ? 'Usuario bloqueado.' : 'Usuario desbloqueado.')
  return (
      <Dialogo cerrar={cerrar} titulo={`${bloquear ? 'Bloquear' : 'Desbloquear'} a ${usuario.nombre}`} accion={accion} enviar={() => form.validateFields().then((v) => accion.mutate({ bloqueado: bloquear, motivo: v.motivo }))} textoOk={bloquear ? 'Bloquear' : 'Desbloquear'} peligro={bloquear}>
        {bloquear && <p>No podrá entrar hasta que alguien lo desbloquee. Sus sesiones abiertas se cierran.</p>}
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item label="Motivo" name="motivo" rules={MOTIVO}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Dialogo>
  )
}

function CambiarRol({ tenant, cerrar, usuario }: Props & { usuario: UsuarioVisible }) {
  const [form] = Form.useForm<{ rol: RolTenant; motivo: string }>()
  const accion = useAccion(tenant.id, cerrar, `/usuarios/${usuario.id}/rol`, 'Rol cambiado.')
  return (
      <Dialogo cerrar={cerrar} titulo={`Cambiar el rol de ${usuario.nombre}`} accion={accion} enviar={() => form.validateFields().then((v) => accion.mutate(v))}>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ rol: usuario.rol }}>
          <Form.Item label="Rol" name="rol">
            <Select options={Object.entries(ROLES_TENANT).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item label="Motivo" name="motivo" rules={MOTIVO}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Dialogo>
  )
}

function Impersonar({ tenant, cerrar }: Props) {
  const [form] = Form.useForm<{ usuario: string; motivo: string }>()
  const consultas = useQueryClient()
  const ir = useNavigate()
  const accion = useMutation({
    mutationFn: (datos: { usuario: string; motivo: string }) => api('POST', `/plataforma/tenants/${tenant.id}/impersonar`, datos),
    onSuccess: async () => {
      await consultas.resetQueries({ queryKey: ['yo'] })
      ir({ to: '/c/$portal', params: { portal: tenant.slug } })
    },
  })
  const admins = tenant.administradores.filter((a) => a.estado === 'active')
  return (
      <Dialogo cerrar={cerrar} titulo={`Entrar como administrador de ${tenant.nombre}`} accion={accion} enviar={() => form.validateFields().then((v) => accion.mutate(v))} textoOk="Entrar">
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="Queda registrado"
          description="Tu nombre, el usuario, la hora de inicio y de fin, el motivo y tu IP quedan en la auditoría del cliente, y el cliente lo ve en su panel. Dura a lo más una hora."
        />
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ usuario: admins[0]?.id }}>
          <Form.Item label="Como" name="usuario" rules={[{ required: true, message: 'Elige al administrador.' }]}>
            <Select options={admins.map((a) => ({ value: a.id, label: `${a.nombre} · ${a.correo}` }))} />
          </Form.Item>
          <Form.Item label="Motivo (el ticket o la solicitud del cliente)" name="motivo" rules={MOTIVO}>
            <Input.TextArea rows={3} placeholder="Ej.: Ticket 4821, el cliente no ve las OT cerradas en el informe" />
          </Form.Item>
        </Form>
      </Dialogo>
  )
}
