// Entrar con correo y clave. Si el mismo correo y la misma clave sirven en varias rectificadoras (o en la consola), se
// elige a cuál. En desarrollo, debajo, «Entrar como»: cualquier persona, sin clave, para probar cada perfil (en
// producción esa ruta no existe y el bloque no aparece).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { Alert, Button, Form, Input, Select } from 'antd'
import { useState } from 'react'
import { PERMISOS_PLATAFORMA, type PermisoPlataforma, TODOS_LOS_PERMISOS } from '../modulos/acceso/permisos'
import { ROLES_TENANT, type RolTenant } from '../modulos/usuarios/reglas'
import { api } from './api'
import { Bloque } from './componentes'

type Personas = {
  equipo: { id: string; nombre: string; correo: string; permisos: PermisoPlataforma[] }[]
  clientes: { id: string; nombre: string; correo: string; rol: RolTenant; tenant: string; estadoTenant: string }[]
}
type Datos = { correo: string; clave: string }
type Respuesta = { ok: true; destino: string } | { elegir: { portal: string; nombre: string }[] }

export function Entrar() {
  const { portal } = useSearch({ from: '/entrar' })
  const consultas = useQueryClient()
  const ir = useNavigate()
  const [form] = Form.useForm<Datos>()
  const [opciones, setOpciones] = useState<{ portal: string; nombre: string }[] | null>(null)
  const listo = async () => {
    await consultas.resetQueries()
    await ir({ to: '/' })
  }
  const entrar = useMutation({
    mutationFn: (v: Datos & { portal?: string }) => api<Respuesta>('POST', '/entrar', v),
    onSuccess: async (r) => {
      if ('elegir' in r) return setOpciones(r.elegir)
      await listo()
    },
  })
  return (
    <div className="entrar">
      <div className="entrar-caja">
        <h1>Entrar</h1>
        <p className="tenue">Con tu correo y tu clave. Si es tu primera vez, entra con el enlace de invitación que te mandaron.</p>
        {entrar.isError && <Alert type="error" showIcon title={(entrar.error as Error).message} style={{ marginBottom: 12 }} />}
        {opciones ? (
          <>
            <p>Tu correo está en más de un lugar. ¿A cuál quieres entrar?</p>
            <div className="personas">
              {opciones.map((o) => (
                <button key={o.portal} type="button" className="persona" disabled={entrar.isPending} onClick={() => entrar.mutate({ ...form.getFieldsValue(), portal: o.portal })}>
                  <b>{o.nombre}</b>
                </button>
              ))}
            </div>
            <Button type="link" style={{ paddingLeft: 0 }} onClick={() => setOpciones(null)}>
              Volver
            </Button>
          </>
        ) : (
          <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => entrar.mutate({ ...v, portal })}>
            <Form.Item label="Correo" name="correo" rules={[{ required: true, whitespace: true, message: 'Escribe tu correo.' }]}>
              <Input type="email" autoComplete="username" autoFocus inputMode="email" />
            </Form.Item>
            <Form.Item label="Clave" name="clave" rules={[{ required: true, message: 'Escribe tu clave.' }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={entrar.isPending}>
              Entrar
            </Button>
            <p className="tenue entrar-nota">¿Olvidaste tu clave? Pide al administrador de tu organización un enlace nuevo.</p>
          </Form>
        )}
      </div>
      <EntrarComo alEntrar={listo} />
    </div>
  )
}

/** Solo en desarrollo: entrar como cualquier persona, sin clave. Si el servidor no tiene la ruta, no aparece. */
function EntrarComo({ alEntrar }: { alEntrar: () => Promise<void> }) {
  const personas = useQuery({ queryKey: ['personas'], queryFn: () => api<Personas>('GET', '/desarrollo/personas'), retry: false })
  const entrar = useMutation({ mutationFn: (id: string) => api('POST', '/desarrollo/entrar', { id }), onSuccess: alEntrar })
  const [tenant, setTenant] = useState<string>()
  if (!personas.data) return null
  const tenants = [...new Set(personas.data.clientes.map((p) => p.tenant))]
  const elegido = tenant ?? tenants.find((t) => t === 'Rectificadora Los Andes') ?? tenants[0]
  const permisos = (p: PermisoPlataforma[]) =>
    p.length === TODOS_LOS_PERMISOS.length ? 'Todos los permisos' : p.length ? `Lectura y: ${p.map((x) => PERMISOS_PLATAFORMA[x].toLowerCase()).join('; ')}` : 'Solo lectura'
  return (
    <div className="entrar-como">
      <h2>Entrar como</h2>
      <p className="tenue">Solo en desarrollo: elige a alguien para ver la plataforma como lo vería esa persona. Todas las personas de la demostración tienen la clave «demo1234».</p>
      {entrar.isError && <Alert type="error" showIcon title={(entrar.error as Error).message} style={{ marginBottom: 12 }} />}
      <Bloque titulo="Equipo de la plataforma (super-admin)">
        <div className="personas">
          {personas.data.equipo.map((p) => (
            <button key={p.id} type="button" className="persona" onClick={() => entrar.mutate(p.id)}>
              <b>{p.nombre}</b>
              <small>{permisos(p.permisos)}</small>
            </button>
          ))}
        </div>
      </Bloque>
      <Bloque
        titulo="Personas de cada rectificadora"
        extra={<Select showSearch optionFilterProp="label" style={{ width: 280, maxWidth: '100%' }} value={elegido} onChange={setTenant} options={tenants.map((t) => ({ value: t, label: t }))} />}
      >
        <div className="personas">
          {personas.data.clientes
            .filter((p) => p.tenant === elegido)
            .map((p) => (
              <button key={p.id} type="button" className="persona" onClick={() => entrar.mutate(p.id)}>
                <b>{p.nombre}</b>
                <small>
                  {ROLES_TENANT[p.rol]} · {p.correo}
                </small>
              </button>
            ))}
        </div>
      </Bloque>
    </div>
  )
}
