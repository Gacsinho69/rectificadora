// La invitación: quien la recibe ve a qué rectificadora entra y con qué correo, define su clave y queda dentro.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Alert, Button, Form, Input } from 'antd'
import { api } from './api'
import { Cargando, Problema } from './componentes'
import { fecha } from './formato'

type Invitacion = { nombre: string; correo: string; organizacion: string; vence: string }

export function Invitacion() {
  const { token } = useParams({ from: '/invitacion/$token' })
  const consultas = useQueryClient()
  const ir = useNavigate()
  const [form] = Form.useForm<{ clave: string; repetida: string }>()
  const inv = useQuery({ queryKey: ['invitacion', token], queryFn: () => api<Invitacion>('GET', `/invitacion/${token}`), retry: false })
  const aceptar = useMutation({
    mutationFn: (clave: string) => api<{ destino: string }>('POST', `/invitacion/${token}`, { clave }),
    onSuccess: async () => {
      await consultas.resetQueries()
      await ir({ to: '/' })
    },
  })
  return (
    <div className="entrar">
      <div className="entrar-caja">
        {inv.isPending ? (
          <Cargando />
        ) : inv.isError ? (
          <>
            <h1>Invitación</h1>
            <Problema error={inv.error} />
            <p className="entrar-nota">
              Si ya definiste tu clave, <Link to="/entrar">entra con tu correo</Link>.
            </p>
          </>
        ) : (
          <>
            <h1>Hola, {inv.data.nombre}</h1>
            <p>
              Te invitaron al sistema de <b>{inv.data.organizacion}</b>. Elige tu clave: con ella y tu correo <b>{inv.data.correo}</b> vas a entrar de aquí en adelante.
            </p>
            {aceptar.isError && <Alert type="error" showIcon title={(aceptar.error as Error).message} style={{ marginBottom: 12 }} />}
            <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => aceptar.mutate(v.clave)}>
              {/* Para que el navegador guarde la clave con el correo correcto. */}
              <input type="email" name="correo" autoComplete="username" value={inv.data.correo} readOnly hidden />
              <Form.Item label="Tu clave" name="clave" extra="Al menos 8 letras o números. Que no sea tu correo." rules={[{ required: true, message: 'Escribe tu clave.' }, { min: 8, message: 'Al menos 8 letras o números.' }]}>
                <Input.Password autoComplete="new-password" autoFocus />
              </Form.Item>
              <Form.Item
                label="Repítela"
                name="repetida"
                dependencies={['clave']}
                rules={[{ required: true, message: 'Repite la clave.' }, ({ getFieldValue }) => ({ validator: (_, v) => (!v || v === getFieldValue('clave') ? Promise.resolve() : Promise.reject(new Error('No es la misma clave.'))) })]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={aceptar.isPending}>
                Guardar mi clave y entrar
              </Button>
            </Form>
            <p className="tenue entrar-nota">Este enlace sirve una sola vez, hasta el {fecha(inv.data.vence)}.</p>
          </>
        )}
      </div>
    </div>
  )
}
