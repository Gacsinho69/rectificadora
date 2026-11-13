// Un documento para imprimir o guardar en PDF (la cotización, la orden de compra, el acta de entrega): una hoja blanca
// con el nombre de la rectificadora, el título, el folio y la fecha. Al imprimir, el menú y los botones no salen.
import { Button } from 'antd'
import { usePersona } from './comun'

export function Documento({ titulo, folio, fecha, volver, children }: { titulo: string; folio: string; fecha: string; volver: React.ReactNode; children: React.ReactNode }) {
  const { persona } = usePersona()
  return (
    <>
      <div className="documento-acciones no-imprimir">
        {volver}
        <Button type="primary" onClick={() => window.print()}>
          Imprimir o guardar en PDF
        </Button>
      </div>
      <article className="documento">
        <header className="doc-cabeza">
          <b className="doc-emisor">{persona?.tenantNombre}</b>
          <div className="doc-folio">
            <h1>{titulo}</h1>
            <b>{folio}</b>
            <span>{fecha}</span>
          </div>
        </header>
        {children}
      </article>
    </>
  )
}

/** Los datos de un documento en dos columnas: «Cliente: …», «Motor: …». Lo vacío no sale. */
export function DatosDoc({ datos }: { datos: [string, React.ReactNode][] }) {
  return (
    <dl className="doc-datos">
      {datos
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  )
}

/** Las líneas para firmar al pie: quién entrega y quién recibe. */
export function Firmas({ firmas }: { firmas: { rotulo: string; nombre?: string | null }[] }) {
  return (
    <div className="doc-firmas">
      {firmas.map((f) => (
        <div key={f.rotulo} className="doc-firma">
          <span>{f.nombre ?? ' '}</span>
          <small>{f.rotulo}</small>
        </div>
      ))}
    </div>
  )
}
