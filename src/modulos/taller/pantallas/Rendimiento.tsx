// El rendimiento del taller: cuánto toman de verdad los trabajos terminados (en horario de taller, sin lo detenido)
// contra sus horas estándar, por actividad y por persona. Si una actividad siempre toma más o menos, su hora estándar
// está mal y la cola de su sección también: el administrador la ajusta aquí con la hora real.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Segmented, Table } from 'antd'
import { useState } from 'react'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Estado, Problema } from '../../../pantallas/componentes'
import { cifra } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { horas, usePersona } from './comun'

type Medida = { trabajos: number; estandar: number; real: number; proporcion: number | null; realPorUnidad: number | null }
type Datos = {
  dias: number
  total: Medida
  actividades: (Medida & { id: string; codigo: string; nombre: string; unidad: string; horasEstandar: number })[]
  personas: (Medida & { id: string; nombre: string })[]
}

/** Cuánto toma contra lo estándar, en palabras: «20 % más», «a la par», «15 % menos». */
function Proporcion({ p }: { p: number | null }) {
  if (p === null) return <span className="tenue">—</span>
  const diferencia = Math.round((p - 1) * 100)
  if (Math.abs(diferencia) < 10) return <span>A la par</span>
  return <Estado tono={diferencia > 0 ? 'naranjo' : 'azul'}>{`${Math.abs(diferencia)} % ${diferencia > 0 ? 'más' : 'menos'}`}</Estado>
}

const h1 = (n: number) => horas(Math.round(n * 10) / 10)

export function Rendimiento() {
  const { esAdmin, suspendida } = usePersona()
  const [dias, setDias] = useState(90)
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const r = useQuery({ queryKey: ['taller', 'rendimiento', dias], queryFn: () => api<Datos>('GET', `/servicio/rendimiento?dias=${dias}`) })
  const ajustar = useMutation({
    mutationFn: ({ id, horas }: { id: string; horas: number }) => api('POST', `/servicio/catalogo/${id}`, { horas }),
    onSuccess: async () => {
      message.success('Hora estándar ajustada: los trabajos nuevos y la cola se cuentan con ella.')
      await consultas.invalidateQueries({ queryKey: ['taller'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
  return (
    <>
      <Encabezado
        titulo="Rendimiento"
        sub="Cuánto toman de verdad los trabajos terminados, en horario de taller y sin lo detenido, contra sus horas estándar."
        acciones={<Segmented value={dias} onChange={(v) => setDias(Number(v))} options={[{ value: 30, label: '30 días' }, { value: 90, label: '90 días' }, { value: 180, label: '180 días' }]} />}
      />
      {r.isPending ? (
        <Cargando />
      ) : r.isError ? (
        <Problema error={r.error} />
      ) : (
        <>
          <Cifras
            cifras={[
              { rotulo: 'Trabajos terminados', valor: cifra(r.data.total.trabajos) },
              { rotulo: 'Horas estándar', valor: h1(r.data.total.estandar) },
              { rotulo: 'Horas reales', valor: h1(r.data.total.real) },
              { rotulo: 'Contra lo estándar', valor: <Proporcion p={r.data.total.proporcion} /> },
            ]}
          />
          <p className="ayuda">
            Las horas reales van de que se inicia un trabajo a que se termina, de 8 a 19 h de lunes a sábado y sin el tiempo detenido. Si alguien hace dos trabajos a la vez, los dos
            cuentan: sirve para ver tendencias, no para medir a nadie al minuto.
          </p>
          <Bloque titulo="Por actividad">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={r.data.actividades}
              scroll={{ x: 900 }}
              locale={{ emptyText: 'Sin trabajos terminados en este período.' }}
              columns={[
                { title: 'Actividad', key: 'n', render: (_, a) => <div className="fila-nombre"><b>{a.nombre}</b><small>{a.codigo}</small></div> },
                { title: 'Trabajos', dataIndex: 'trabajos', align: 'right', width: 90 },
                { title: 'Estándar', dataIndex: 'estandar', align: 'right', width: 100, render: (v: number) => h1(v) },
                { title: 'Real', dataIndex: 'real', align: 'right', width: 100, render: (v: number) => h1(v) },
                { title: 'Contra lo estándar', key: 'p', width: 150, render: (_, a) => <Proporcion p={a.proporcion} /> },
                {
                  title: `Hora por unidad`,
                  key: 'u',
                  width: 220,
                  render: (_, a) => {
                    const real = a.realPorUnidad === null ? null : Math.round(a.realPorUnidad * 100) / 100
                    const fuera = a.proporcion !== null && Math.abs(a.proporcion - 1) >= 0.1 && a.trabajos >= 3
                    return (
                      <span className="evento-nombre">
                        <span>
                          {horas(a.horasEstandar)} → <b>{real === null ? '—' : horas(real)}</b> <span className="tenue">por {a.unidad}</span>
                        </span>
                        {esAdmin && !suspendida && fuera && real !== null && real > 0 && (
                          <Button size="small" type="link" loading={ajustar.isPending && ajustar.variables?.id === a.id} onClick={() => ajustar.mutate({ id: a.id, horas: real })}>
                            Usar {horas(real)}
                          </Button>
                        )}
                      </span>
                    )
                  },
                },
              ]}
            />
          </Bloque>
          <Bloque titulo="Por persona">
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={r.data.personas}
              scroll={{ x: 600 }}
              locale={{ emptyText: 'Sin trabajos terminados en este período.' }}
              columns={[
                { title: 'Persona', dataIndex: 'nombre' },
                { title: 'Trabajos', dataIndex: 'trabajos', align: 'right', width: 90 },
                { title: 'Estándar', dataIndex: 'estandar', align: 'right', width: 100, render: (v: number) => h1(v) },
                { title: 'Real', dataIndex: 'real', align: 'right', width: 100, render: (v: number) => h1(v) },
                { title: 'Contra lo estándar', key: 'p', width: 150, render: (_, a) => <Proporcion p={a.proporcion} /> },
              ]}
            />
          </Bloque>
        </>
      )}
    </>
  )
}
