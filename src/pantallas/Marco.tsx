// El chasis de la consola y del panel del cliente: el menú pizarra a la izquierda (un cajón en el celular) y la página.
import { MenuOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import { Drawer } from 'antd'
import { useEffect, useState } from 'react'
import { api } from './api'

export type Enlace = { a: string; texto: string; icono: React.ReactNode; cuenta?: number; activo?: boolean; search?: Record<string, unknown>; params?: Record<string, string> }

export function Marco({ titulo, subtitulo, enlaces, persona, aviso, children }: { titulo: string; subtitulo: string; enlaces: Enlace[]; persona: { nombre: string; detalle: string }; aviso?: React.ReactNode; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false)
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
    </div>
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
