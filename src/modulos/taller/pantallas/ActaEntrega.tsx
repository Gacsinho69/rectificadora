// El acta de entrega de una OT: el motor, lo que se le hizo pieza por pieza (con las medidas que se anotaron), los
// repuestos que lleva y quién lo recibe, con las firmas. Sin montos. Se imprime al entregar.
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { api } from '../../../pantallas/api'
import { Cargando, Problema } from '../../../pantallas/componentes'
import { cifra, fecha } from '../../../pantallas/formato'
import { referenciaDe } from '../../compras/reglas'
import { nombreDeGrupo } from '../reglas'
import { folioOt, textoMotor, usePersona, usePortal } from './comun'
import { DatosDoc, Documento, Firmas } from './Documento'
import type { DetalleOt } from './tipos'

const ruta = getRouteApi('/c/$portal/ot/$id/acta')

export function ActaEntrega() {
  const { id } = ruta.useParams()
  const portal = usePortal()
  const { persona } = usePersona()
  const r = useQuery({ queryKey: ['taller', 'ot', id], queryFn: () => api<DetalleOt>('GET', `/servicio/ot/${id}`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const ot = r.data
  const hechos = ot.tareas.filter((t) => t.estado === 'done')
  // Lo hecho, por pieza, en el orden de la OT (el diagnóstico, cada pieza, el armado y el control).
  const grupos = [...new Set(hechos.map((t) => t.grupo))].map((g) => ({ g, tareas: hechos.filter((t) => t.grupo === g) }))
  const repuestos = ot.repuestos.filter((x) => x.estado === 'received')
  return (
    <Documento titulo="Acta de entrega" folio={folioOt(ot.numero)} fecha={fecha(ot.entregada ?? new Date().toISOString())} volver={<Link to="/c/$portal/ot/$id" params={{ portal, id }}>Volver a la OT</Link>}>
      {ot.estado !== 'delivered' && <p className="doc-aviso">Todavía no se entrega: el acta queda lista para firmar al entregar.</p>}
      <DatosDoc
        datos={[
          ['Cliente', ot.cliente.nombre],
          ['Motor', ot.motor],
          ['N° de motor', ot.numeroMotor],
          ['Datos del motor', textoMotor(ot)],
          ['Equipo', ot.equipo],
          ['Recibido', fecha(ot.creada)],
          ['Falla informada', ot.falla],
        ]}
      />
      <section className="doc-seccion">
        <h3>Trabajos realizados</h3>
        {grupos.length ? (
          grupos.map(({ g, tareas }) => (
            <div key={g} className="doc-grupo">
              <b>{nombreDeGrupo(g)}</b>
              <ul>
                {tareas.map((t) => (
                  <li key={t.id}>
                    {t.nombre}
                    {t.resultado && <small> · {t.resultado}</small>}
                  </li>
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p>Sin trabajos terminados.</p>
        )}
      </section>
      {repuestos.length > 0 && (
        <section className="doc-seccion">
          <h3>Repuestos</h3>
          <table className="doc-tabla">
            <thead>
              <tr>
                <th>Repuesto</th>
                <th>Medida, marca y código</th>
                <th className="num">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {repuestos.map((x) => (
                <tr key={x.id}>
                  <td>
                    {x.descripcion}
                    {x.compra === 'customer' && <small> · lo trajo el cliente</small>}
                  </td>
                  <td>{referenciaDe(x) || '—'}</td>
                  <td className="num">{cifra(x.cantidad)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="doc-pie">El cliente recibe el motor conforme, con los trabajos y repuestos que aquí se indican.</p>
      <Firmas firmas={[{ rotulo: `Entrega · ${persona?.tenantNombre ?? ''}` }, { rotulo: 'Recibe conforme', nombre: ot.entregadaA }]} />
    </Documento>
  )
}
