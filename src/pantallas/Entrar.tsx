// Solo en desarrollo: entrar como cualquier persona, sin clave, para probar cada perfil. En producción esta pantalla
// la reemplaza el inicio de sesión del portal.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Select } from 'antd'
import { useState } from 'react'
import { PERMISOS_PLATAFORMA, type PermisoPlataforma, TODOS_LOS_PERMISOS } from '../modulos/acceso/permisos'
import { ROLES_TENANT, type RolTenant } from '../modulos/usuarios/reglas'
import { api } from './api'
import { Bloque, Cargando, Problema } from './componentes'

type Personas = {
  equipo: { id: string; nombre: string; correo: string; permisos: PermisoPlataforma[] }[]
  clientes: { id: string; nombre: string; correo: string; rol: RolTenant; tenant: string; estadoTenant: string }[]
}

export function Entrar() {
  const personas = useQuery({ queryKey: ['personas'], queryFn: () => api<Personas>('GET', '/desarrollo/personas') })
  const consultas = useQueryClient()
  const ir = useNavigate()
  const entrar = useMutation({
    mutationFn: (id: string) => api('POST', '/desarrollo/entrar', { id }),
    onSuccess: async () => {
      await consultas.resetQueries()
      ir({ to: '/' })
    },
  })
  const [tenant, setTenant] = useState<string>()
  if (personas.isPending) return <div className="entrar"><Cargando /></div>
  if (personas.isError) return <div className="entrar"><Problema error={personas.error} /></div>
  const tenants = [...new Set(personas.data.clientes.map((p) => p.tenant))]
  const elegido = tenant ?? tenants.find((t) => t === 'Rectificadora Los Andes') ?? tenants[0]
  const permisos = (p: PermisoPlataforma[]) =>
    p.length === TODOS_LOS_PERMISOS.length ? 'Todos los permisos' : p.length ? `Lectura y: ${p.map((x) => PERMISOS_PLATAFORMA[x].toLowerCase()).join('; ')}` : 'Solo lectura'
  return (
    <div className="entrar">
      <h1>Entrar como</h1>
      <p className="tenue">Solo en desarrollo: elige a alguien para ver la plataforma como lo vería esa persona.</p>
      {entrar.isError && <Problema error={entrar.error} />}
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
        extra={<Select showSearch optionFilterProp="label" style={{ width: 280 }} value={elegido} onChange={setTenant} options={tenants.map((t) => ({ value: t, label: t }))} />}
      >
        <div className="personas">
          {personas.data.clientes.filter((p) => p.tenant === elegido).map((p) => (
            <button key={p.id} type="button" className="persona" onClick={() => entrar.mutate(p.id)}>
              <b>{p.nombre}</b>
              <small>
                {ROLES_TENANT[p.rol]}
              </small>
            </button>
          ))}
        </div>
      </Bloque>
    </div>
  )
}
