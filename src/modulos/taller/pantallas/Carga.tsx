// La carga del taller. Por sección: su gente (quienes hacen sus actividades), las horas para hacer ahora, las que
// esperan su turno, lo detenido, lo sin asignar y cuántos días de cola son. Por persona: lo que tiene. Sirve para ver
// el cuello de botella antes de prometer una fecha. Lo sin asignar se reparte con un botón, con las reglas de siempre.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { App, Button, Table } from 'antd'
import { api } from '../../../pantallas/api'
import { Bloque, Cargando, Cifras, Problema } from '../../../pantallas/componentes'
import { cifra } from '../../../pantallas/formato'
import { Encabezado } from '../../../pantallas/Marco'
import { ROLES_TENANT } from '../../usuarios/reglas'
import { dias, horas, usePersona, usePortal } from './comun'
import type { CargaPersona, CargaSeccion } from './tipos'

export function Carga() {
  const portal = usePortal()
  const { gestiona, suspendida } = usePersona()
  const consultas = useQueryClient()
  const { message } = App.useApp()
  const r = useQuery({ queryKey: ['taller', 'carga'], queryFn: () => api<{ secciones: CargaSeccion[]; personas: CargaPersona[] }>('GET', '/servicio/carga') })
  const repartir = useMutation({
    mutationFn: (id: string) => api<{ repartidos: number }>('POST', `/servicio/secciones/${id}/repartir`),
    onSuccess: (x) => {
      if (x.repartidos) message.success(`Repartidos ${x.repartidos} trabajos entre los especialistas.`)
      else message.info('Nada que repartir: esas actividades no tienen especialistas. Asígnalos en la Lista de trabajos.')
      return consultas.invalidateQueries({ queryKey: ['taller'] })
    },
    onError: (e) => message.error((e as Error).message),
  })
  if (r.isPending) return <Cargando />
  if (r.isError) return <Problema error={r.error} />
  const { secciones, personas } = r.data
  const suma = (f: (s: CargaSeccion) => number) => secciones.reduce((t, s) => t + f(s), 0)
  const peor = [...secciones].filter((s) => s.dias !== null && s.ahora + s.espera > 0).sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0))[0]
  const maximo = Math.max(1, ...secciones.map((s) => s.ahora + s.espera))
  return (
    <>
      <Encabezado titulo="Carga del taller" sub="Horas estándar de lo que falta hacer en las OT del taller." />
      <Cifras
        cifras={[
          { rotulo: 'Para hacer ahora', valor: horas(Math.round(suma((s) => s.ahora))), nota: 'en proceso o con su turno' },
          { rotulo: 'Esperan su turno', valor: horas(Math.round(suma((s) => s.espera))), nota: 'falta lo anterior de su pieza' },
          { rotulo: 'Detenidos', valor: cifra(suma((s) => s.nDetenidas)), tono: suma((s) => s.nDetenidas) ? 'naranjo' : undefined, nota: 'repuestos, cliente, terceros' },
          { rotulo: 'Sin asignar', valor: cifra(suma((s) => s.sinAsignar)), tono: suma((s) => s.sinAsignar) ? 'dorado' : undefined },
          peor && { rotulo: 'Sección más cargada', valor: <span style={{ fontSize: 15 }}>{peor.nombre}</span>, nota: `${dias(redondear(peor.dias))} de cola` },
        ]}
      />
      <Bloque titulo="Por sección" extra={<span className="tenue">La gente de una sección es la que hace sus actividades. Se cambia en <Link to="/c/$portal/actividades" params={{ portal }}>Lista de trabajos</Link>.</span>}>
        <Table<CargaSeccion>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={secciones}
          scroll={{ x: 900 }}
          columns={[
            { title: 'Sección', dataIndex: 'nombre', render: (v: string) => <b>{v}</b> },
            { title: 'Gente', key: 'g', render: (_, s) => (s.gente.length ? s.gente.map((g) => g.nombre).join(', ') : <span className="estado dorado">Sin especialistas</span>) },
            {
              title: 'Por hacer',
              key: 'h',
              width: 190,
              render: (_, s) => (
                <span className="medidor" title={`${horas(s.ahora)} para hacer ahora y ${horas(s.espera)} esperando su turno`}>
                  <span className="medidor-barra azul" style={{ width: 90 }}>
                    <span style={{ width: `${((s.ahora + s.espera) / maximo) * 100}%` }} />
                  </span>
                  <span className="medidor-valor">{horas(Math.round(s.ahora + s.espera))}</span>
                </span>
              ),
            },
            { title: 'Ahora', dataIndex: 'ahora', align: 'right', render: (v: number) => horas(Math.round(v)) },
            { title: 'Esperan', dataIndex: 'espera', align: 'right', render: (v: number) => (v ? horas(Math.round(v)) : <span className="tenue">—</span>) },
            { title: 'Detenidos', dataIndex: 'nDetenidas', align: 'right', render: (v: number) => (v ? <span className="estado naranjo">{v}</span> : <span className="tenue">—</span>) },
            {
              title: 'Sin asignar',
              key: 's',
              align: 'right',
              render: (_, s) =>
                s.sinAsignar ? (
                  <span className="evento-nombre" style={{ justifyContent: 'flex-end' }}>
                    {s.sinAsignar}
                    {gestiona && !suspendida && (
                      <Button size="small" loading={repartir.isPending && repartir.variables === s.id} onClick={() => repartir.mutate(s.id)}>
                        Repartir
                      </Button>
                    )}
                  </span>
                ) : (
                  <span className="tenue">—</span>
                ),
            },
            { title: 'Cola', dataIndex: 'dias', align: 'right', render: (v: number | null, s) => (s.ahora + s.espera ? dias(redondear(v)) : <span className="tenue">—</span>) },
          ]}
        />
      </Bloque>
      <Bloque titulo="Por persona">
        <Table<CargaPersona>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={personas}
          scroll={{ x: 820 }}
          columns={[
            { title: 'Persona', key: 'n', render: (_, p) => <div className="fila-nombre"><b>{p.nombre}</b><small>{ROLES_TENANT[p.rol]}</small></div> },
            { title: 'Hace', key: 'a', render: (_, p) => (p.actividades ? `${p.actividades} actividades · ${p.secciones.join(', ')}` : <span className="tenue">Ninguna actividad</span>) },
            { title: 'En proceso', dataIndex: 'enProceso', align: 'right', render: (v: number) => v || <span className="tenue">—</span> },
            { title: 'Para hacer ahora', dataIndex: 'ahora', align: 'right', render: (v: number) => (v ? horas(Math.round(v * 10) / 10) : <span className="tenue">—</span>) },
            { title: 'Esperan', dataIndex: 'espera', align: 'right', render: (v: number) => (v ? horas(Math.round(v * 10) / 10) : <span className="tenue">—</span>) },
            { title: 'Detenidos', dataIndex: 'nDetenidas', align: 'right', render: (v: number) => (v ? <span className="estado naranjo">{v}</span> : <span className="tenue">—</span>) },
          ]}
        />
      </Bloque>
    </>
  )
}

const redondear = (d: number | null) => (d === null ? null : Math.round(d * 10) / 10)
