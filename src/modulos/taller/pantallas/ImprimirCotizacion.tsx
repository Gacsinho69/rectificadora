// La cotización como la recibe el cliente: lo que se le va a hacer al motor, con su cantidad y su valor, y los
// totales con IVA. Sin lo interno (proveedores, costos, horas). Se imprime o se guarda en PDF para enviarla.
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { api } from '../../../pantallas/api'
import { Cargando, Problema } from '../../../pantallas/componentes'
import { cifra, fecha, plata } from '../../../pantallas/formato'
import { loTraeElCliente } from '../../comercial/reglas'
import { folioCot, folioOt, textoMotor, usePortal } from './comun'
import { DatosDoc, Documento } from './Documento'
import type { DetalleCotizacion } from './tipos'

const ruta = getRouteApi('/c/$portal/cotizaciones/$id/imprimir')

export function ImprimirCotizacion() {
  const { id } = ruta.useParams()
  const portal = usePortal()
  const r = useQuery({ queryKey: ['taller', 'cotizacion', id], queryFn: () => api<DetalleCotizacion>('GET', `/servicio/cotizaciones/${id}`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const q = r.data
  return (
    <Documento titulo="Cotización" folio={folioCot(q.numero)} fecha={fecha(q.enviada ?? q.creada)} volver={<Link to="/c/$portal/cotizaciones/$id" params={{ portal, id }}>Volver a la cotización</Link>}>
      {q.estado === 'draft' && <p className="doc-aviso">Borrador: todavía no se envía al cliente.</p>}
      <DatosDoc
        datos={[
          ['Cliente', q.cliente.nombre],
          ['RUT', q.cliente.rut],
          ['Atención', q.cliente.contacto],
          ['Motor', q.motor],
          ['Datos del motor', textoMotor(q)],
          ['Orden de trabajo', q.ot ? folioOt(q.ot.numero) : null],
        ]}
      />
      <table className="doc-tabla">
        <thead>
          <tr>
            <th>Descripción</th>
            <th className="num">Cantidad</th>
            <th className="num">Valor unitario</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {q.lineas.map((l, i) => (
            <tr key={i}>
              <td>
                {l.descripcion}
                {l.tipo === 'repuesto' && (l.medida || l.marca) && <small> · {[l.medida, l.marca].filter(Boolean).join(' · ')}</small>}
                {loTraeElCliente(l) && <small> · lo trae el cliente</small>}
              </td>
              <td className="num">{cifra(l.cantidad)}</td>
              <td className="num">{loTraeElCliente(l) || !l.precio ? '—' : plata(l.precio)}</td>
              <td className="num">{loTraeElCliente(l) ? 'No se cobra' : l.precio ? plata(Math.round(l.cantidad * l.precio)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="doc-totales">
        <tbody>
          <tr>
            <td>Subtotal</td>
            <td className="num">{plata(q.subtotal)}</td>
          </tr>
          {q.rebaja > 0 && (
            <tr>
              <td>Descuento {q.descuento} %</td>
              <td className="num">−{plata(q.rebaja)}</td>
            </tr>
          )}
          <tr>
            <td>Neto</td>
            <td className="num">{plata(q.neto)}</td>
          </tr>
          <tr>
            <td>IVA 19 %</td>
            <td className="num">{plata(q.iva)}</td>
          </tr>
          <tr className="total">
            <td>Total</td>
            <td className="num">{plata(q.total)}</td>
          </tr>
        </tbody>
      </table>
      {q.notas && (
        <section className="doc-seccion">
          <h3>Condiciones</h3>
          <p>{q.notas}</p>
        </section>
      )}
      <p className="doc-pie">Valores en pesos chilenos. Los trabajos se cuentan con los datos del motor; si al desarmar aparece algo más, se cotiza aparte.</p>
    </Documento>
  )
}
