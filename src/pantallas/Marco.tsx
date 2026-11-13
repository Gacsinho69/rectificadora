// El chasis de la consola y del panel del cliente: el menú pizarra a la izquierda (un cajón en el celular) y la página.
import { MenuOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { Alert, App, Drawer, Form, Input, Modal } from 'antd'
import { useEffect, useState } from 'react'
import { api } from './api'

export type Enlace = { a: string; texto: string; icono: React.ReactNode; cuenta?: number; activo?: boolean; search?: Record<string, unknown>; params?: Record<string, string> }

export function Marco({ titulo, subtitulo, enlaces, persona, aviso, children }: { titulo: string; subtitulo: string; enlaces: Enlace[]; persona: { nombre: string; detalle: string }; aviso?: React.ReactNode; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
  const [cambiandoClave, setCambiandoClave] = useState(false)
  const ruta = useRouterState({ select: (s) => s.location.href })
  useEffect(() => setAbierto(false), [ruta])
  const consultas = useQueryClient()
  const salir = async () => {
    await api('POST', '/salir')
    consultas.clear()
    window.location.assign('/entrar')
  }
  const lado = (
    <aside className="marco-lado">
      <div className="marco-marca">
        <b>{titulo}</b>
        <span>{subtitulo}</span>
      </div>
      <nav className="marco-nav">
        {enlaces.map((e) => (
          <Link key={e.texto} to={e.a} params={e.params as never} search={e.search as never} className={`marco-enlace${e.activo ? ' activo' : ''}`}>
            {e.icono}
            {e.texto}
            {e.cuenta ? <span className="cuenta">{e.cuenta}</span> : null}
          </Link>
        ))}
      </nav>
      <div className="marco-pie">
        <b>{persona.nombre}</b>
        {persona.detalle}
        <div>
          <button type="button" onClick={() => setCambiandoClave(true)}>
            Cambiar clave
          </button>
          {' · '}
          <button type="button" onClick={salir}>
            Salir
          </button>
        </div>
      </div>
    </aside>
  )
  return (
    <div className="marco">
      {lado}
      <div className="marco-barra">
        <button type="button" aria-label="Abrir menú" onClick={() => setAbierto(true)}>
          <MenuOutlined />
        </button>
        <b>{titulo}</b>
      </div>
      <Drawer open={abierto} onClose={() => setAbierto(false)} placement="left" closable={false} className="cajon" styles={{ wrapper: { width: 240 } }}>
        {lado}
      </Drawer>
      <main className="marco-pagina">
        {aviso}
        <div className="pagina">{children}</div>
      </main>
      {cambiandoClave && <CambiarClave cerrar={() => setCambiandoClave(false)} />}
    </div>
  )
}

/** Cambiar la propia clave, con la de ahora. Las otras sesiones (otro computador, el celular) se cierran. */
function CambiarClave({ cerrar }: { cerrar: () => void }) {
  const [form] = Form.useForm<{ actual: string; nueva: string; repetida: string }>()
  const { message } = App.useApp()
  const cambiar = useMutation({
    mutationFn: (v: { actual: string; nueva: string }) => api('POST', '/clave', { actual: v.actual, nueva: v.nueva }),
    onSuccess: () => {
      message.success('Clave cambiada. Si tenías la sesión abierta en otro lado, allá tendrás que entrar de nuevo.')
      cerrar()
    },
  })
  return (
    <Modal open title="Cambiar mi clave" okText="Cambiar" cancelText="Cancelar" confirmLoading={cambiar.isPending} onCancel={() => !cambiar.isPending && cerrar()} onOk={() => form.validateFields().then((v) => cambiar.mutate(v))} destroyOnHidden>
      {cambiar.isError && <Alert type="error" showIcon title={(cambiar.error as Error).message} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item label="Clave de ahora" name="actual" rules={[{ required: true, message: 'Escribe tu clave de ahora.' }]}>
          <Input.Password autoComplete="current-password" autoFocus />
        </Form.Item>
        <Form.Item label="Clave nueva" name="nueva" extra="Al menos 8 letras o números. Que no sea tu correo." rules={[{ required: true, message: 'Escribe la clave nueva.' }, { min: 8, message: 'Al menos 8 letras o números.' }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          label="Repite la clave nueva"
          name="repetida"
          dependencies={['nueva']}
          rules={[{ required: true, message: 'Repite la clave nueva.' }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue('nueva') ? Promise.resolve() : Promise.reject(new Error('No es la misma clave.'))) })]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export function Encabezado({ titulo, sub, acciones, miga }: { titulo: React.ReactNode; sub?: React.ReactNode; acciones?: React.ReactNode; miga?: React.ReactNode }) {
  return (
    <>
      {miga && <div className="miga">{miga}</div>}
      <div className="encabezado">
        <div>
          <h1>{titulo}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {acciones && <div className="acciones">{acciones}</div>}
      </div>
    </>
  )
}
