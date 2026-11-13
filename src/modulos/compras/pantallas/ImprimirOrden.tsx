// La orden de compra para el proveedor: lo que se le pide (con medida, marca y número de parte) y a cuánto, quién la
// pide y quién va a buscarla. Sin el cliente ni la OT: eso es del taller. Se imprime o se guarda en PDF para enviarla.
import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { api } from '../../../pantallas/api'
import { Cargando, Problema } from '../../../pantallas/componentes'
import { cifra, fecha, plata } from '../../../pantallas/formato'
import { usePortal } from '../../taller/pantallas/comun'
import { DatosDoc, Documento, Firmas } from '../../taller/pantallas/Documento'
import { folioOc, referenciaDe } from '../reglas'

type Linea = { descripcion: string; medida: string | null; marca: string | null; codigo: string | null; cantidad: number; unidad: string | null; costo: number | null }
export type OrdenParaImprimir = {
  numero: number
  estado: string
  creada: string
  llega: string | null
  nota: string | null
  pedidoPor: string | null
  chofer: string | null
  proveedor: { nombre: string; rut: string | null; contacto: string | null; telefono: string | null; correo: string | null; direccion: string | null }
  lineas: Linea[]
  neto: number
  iva: number
  total: number
}

const ruta = getRouteApi('/c/$portal/compras/ordenes/$id')

export function ImprimirOrden() {
  const { id } = ruta.useParams()
  const portal = usePortal()
  const r = useQuery({ queryKey: ['taller', 'orden', id], queryFn: () => api<OrdenParaImprimir>('GET', `/servicio/compras/ordenes/${id}`) })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const o = r.data
  return (
    <Documento titulo="Orden de compra" folio={folioOc(o.numero)} fecha={fecha(o.creada)} volver={<Link to="/c/$portal/compras" params={{ portal }}>Volver a compras</Link>}>
      {o.estado === 'cancelled' && <p className="doc-aviso">Anulada: no vale como pedido.</p>}
      <DatosDoc
        datos={[
          ['Proveedor', o.proveedor.nombre],
          ['RUT', o.proveedor.rut],
          ['Atención', o.proveedor.contacto],
          ['Teléfono', o.proveedor.telefono],
          ['Correo', o.proveedor.correo],
          ['Retira', o.chofer],
          ['Lo necesitamos', o.llega ? fecha(`${o.llega}T12:00:00Z`) : null],
        ]}
      />
      <table className="doc-tabla">
        <thead>
          <tr>
            <th>Artículo</th>
            <th>Medida, marca y código</th>
            <th className="num">Cantidad</th>
            <th className="num">Valor unitario</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {o.lineas.map((l, i) => (
            <tr key={i}>
              <td>{l.descripcion}</td>
              <td>{referenciaDe(l) || '—'}</td>
              <td className="num">
                {cifra(l.cantidad)}
                {l.unidad ? ` ${l.unidad}` : ''}
              </td>
              <td className="num">{l.costo ? plata(l.costo) : '—'}</td>
              <td className="num">{l.costo ? plata(Math.round(l.costo * l.cantidad)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {o.neto > 0 && (
        <table className="doc-totales">
          <tbody>
            <tr>
              <td>Neto</td>
              <td className="num">{plata(o.neto)}</td>
            </tr>
            <tr>
              <td>IVA 19 %</td>
              <td className="num">{plata(o.iva)}</td>
            </tr>
            <tr className="total">
              <td>Total</td>
              <td className="num">{plata(o.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {o.nota && (
        <section className="doc-seccion">
          <h3>Nota</h3>
          <p>{o.nota}</p>
        </section>
      )}
      <Firmas firmas={[{ rotulo: 'Pide', nombre: o.pedidoPor }, { rotulo: 'Entrega el proveedor' }]} />
    </Documento>
  )
}
