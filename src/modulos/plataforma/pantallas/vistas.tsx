// Las vistas de UN cliente que se ven igual en la ficha de la consola y en el panel del administrador del cliente.
// Reciben los datos ya pedidos: quién puede verlos lo decide el servidor, no estas piezas.
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Form, Input, Segmented, Select, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { api, consulta } from '../../../pantallas/api'
import { Barras, Bloque, Cifras, EstadoUsuarioTag, Estado, FacturaTag, Hace, IntegracionTag, Medidor, PagoTag, Problema, TablaEventos } from '../../../pantallas/componentes'
import { cifra, cifraCorta, fecha, megas, plata } from '../../../pantallas/formato'
import { CATEGORIAS, type Categoria } from '../../eventos/tipos'
import { TIPOS_INTEGRACION } from '../../integraciones/reglas'
import { PLANES } from '../../tenants/reglas'
import { ROLES_TENANT } from '../../usuarios/reglas'
import type { Dia, FacturacionTenant, Integraciones, PaginaEventos, SeguridadTenant, Uso, UsoTenant, UsuarioVisible } from './tipos'

const diaCorto = (d: string) => fecha(`${d}T12:00:00Z`)

/** Junta los días en semanas (desde el lunes) o meses, sumando. */
export function agrupar(dias: Dia[], por: 'dia' | 'semana' | 'mes', campo: keyof Omit<Dia, 'dia'>) {
  if (por === 'dia') return dias.map((d) => ({ etiqueta: diaCorto(d.dia), valor: d[campo] }))
  const grupos = new Map<string, number>()
  for (const d of dias) {
    const f = new Date(`${d.dia}T12:00:00Z`)
    let clave = d.dia.slice(0, 7)
    if (por === 'semana') {
      const lunes = new Date(f.getTime() - ((f.getUTCDay() + 6) % 7) * 86_400_000)
      clave = lunes.toISOString().slice(0, 10)
    }
    grupos.set(clave, (grupos.get(clave) ?? 0) + d[campo])
  }
  return [...grupos].map(([clave, valor]) => ({
    etiqueta: por === 'semana' ? `Sem. ${diaCorto(clave)}` : new Date(`${clave}-15T12:00:00Z`).toLocaleDateString('es-CL', { month: 'short', year: 'numeric' }),
    valor,
  }))
}

export function ActividadPorPeriodo({ dias, campo = 'logins', nombre = 'Ingresos' }: { dias: Dia[]; campo?: keyof Omit<Dia, 'dia'>; nombre?: string }) {
  const [por, setPor] = useState<'dia' | 'semana' | 'mes'>('dia')
  return (
    <Bloque
      titulo={`${nombre} por ${por === 'dia' ? 'día' : por}`}
      extra={<Segmented size="small" value={por} onChange={(v) => setPor(v as typeof por)} options={[{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes' }]} />}
    >
      <Barras nombre={nombre} datos={agrupar(dias, por, campo)} />
    </Bloque>
  )
}

export function TablaUsuarios({ usuarios, acciones }: { usuarios: UsuarioVisible[]; acciones?: (u: UsuarioVisible) => React.ReactNode }) {
  const columnas: ColumnsType<UsuarioVisible> = [
    { title: 'Nombre', key: 'n', fixed: 'left', width: 220, render: (_, u) => <div className="fila-nombre"><b>{u.nombre}</b><small>{u.correo}</small></div>, sorter: (a, b) => a.nombre.localeCompare(b.nombre, 'es') },
    { title: 'Rol', dataIndex: 'rol', render: (v: UsuarioVisible['rol']) => ROLES_TENANT[v], filters: Object.entries(ROLES_TENANT).map(([value, text]) => ({ value, text })), onFilter: (v, u) => u.rol === v },
    { title: 'Estado', dataIndex: 'estado', render: (v: UsuarioVisible['estado']) => <EstadoUsuarioTag estado={v} />, filters: [{ value: 'active', text: 'Activo' }, { value: 'blocked', text: 'Bloqueado' }, { value: 'invited', text: 'Invitado' }], onFilter: (v, u) => u.estado === v },
    { title: 'MFA', dataIndex: 'mfa', render: (v: boolean, u) => (u.estado === 'invited' ? <span className="tenue">—</span> : v ? 'Sí' : <span className="tenue">No</span>) },
    { title: 'Último ingreso', dataIndex: 'ultimoLogin', render: (v: string | null) => <Hace iso={v} />, sorter: (a, b) => (a.ultimoLogin ?? '').localeCompare(b.ultimoLogin ?? ''), defaultSortOrder: 'descend' },
    { title: 'Última IP', dataIndex: 'ultimaIp', render: (v: string | null) => <span className="mono">{v ?? '—'}</span> },
    { title: 'Creado', dataIndex: 'creado', render: (v: string, u) => (u.estado === 'invited' ? `Invitado ${fecha(u.invitado)}` : fecha(v)), sorter: (a, b) => a.creado.localeCompare(b.creado) },
    ...(acciones ? [{ title: '', key: 'a', width: 1, render: (_: unknown, u: UsuarioVisible) => acciones(u) }] : []),
  ]
  return <Table size="small" rowKey="id" dataSource={usuarios} columns={columnas} scroll={{ x: 980 }} pagination={usuarios.length > 50 ? { pageSize: 50 } : false} />
}

/**
 * Quién es una persona nueva: nombre, correo y, si se pide, su rol. Va dentro de un `Form`; con `prefijo` los campos
 * quedan bajo ese nombre (el administrador del alta de una rectificadora).
 */
export function CamposDePersona({ prefijo, conRol = true }: { prefijo?: string; conRol?: boolean }) {
  const nombre = (campo: string) => (prefijo ? [prefijo, campo] : campo)
  return (
    <div className="columnas">
      <Form.Item label="Nombre y apellido" name={nombre('nombre')} rules={[{ required: true, message: 'Escribe el nombre y el apellido.' }, { min: 3, message: 'Escribe el nombre y el apellido.' }]}>
        <Input placeholder="Rosa Muñoz" />
      </Form.Item>
      <Form.Item label="Correo" name={nombre('correo')} rules={[{ required: true, message: 'Escribe el correo.' }, { type: 'email', message: 'El correo no es válido.' }]}>
        <Input placeholder="rosa@rectificadora.cl" />
      </Form.Item>
      {conRol && (
        <Form.Item label="Rol" name={nombre('rol')} rules={[{ required: true, message: 'Elige el rol.' }]} extra="El técnico no ve montos; el jefe de taller recibe, cotiza, asigna y compra.">
          <Select options={Object.entries(ROLES_TENANT).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
      )}
    </div>
  )
}

export function CifrasUsuarios({ usuarios }: { usuarios: UsuarioVisible[] }) {
  const registrados = usuarios.filter((u) => u.estado !== 'invited')
  const hace30 = Date.now() - 30 * 86_400_000
  return (
    <Cifras
      cifras={[
        { rotulo: 'Usuarios', valor: cifra(registrados.length) },
        { rotulo: 'Activos (30 días)', valor: cifra(registrados.filter((u) => u.estado === 'active' && u.ultimoLogin && Date.parse(u.ultimoLogin) > hace30).length) },
        { rotulo: 'Bloqueados', valor: cifra(usuarios.filter((u) => u.estado === 'blocked').length) },
        { rotulo: 'Invitaciones pendientes', valor: cifra(usuarios.filter((u) => u.estado === 'invited').length) },
        { rotulo: 'Administradores', valor: cifra(registrados.filter((u) => u.rol === 'admin').length) },
        { rotulo: 'Con MFA', valor: `${cifra(registrados.filter((u) => u.mfa).length)} de ${cifra(registrados.length)}` },
      ]}
    />
  )
}

const valorLimite = (u: Uso) => (u.clave === 'storage_mb' ? megas(u.usado) : cifra(u.usado))
const topeLimite = (u: Uso) => (u.clave === 'storage_mb' ? megas(u.limite) : cifra(u.limite))

export function TablaLimites({ usos, ajustados = {} }: { usos: Uso[]; ajustados?: Partial<Record<string, number>> }) {
  return (
    <Table
      size="small"
      rowKey="clave"
      pagination={false}
      dataSource={usos}
      columns={[
        { title: 'Límite', dataIndex: 'nombre' },
        { title: 'Usado', key: 'u', align: 'right', render: (_, u) => valorLimite(u) },
        { title: 'Contratado', key: 'l', align: 'right', render: (_, u) => <>{topeLimite(u)}{ajustados[u.clave] !== undefined && <span className="tenue"> (ajustado)</span>}</> },
        { title: 'Ocupado', key: 'f', render: (_, u) => <Medidor fraccion={u.fraccion} /> },
      ]}
    />
  )
}

const SERIES = { api: 'Llamadas a la API', ots: 'Órdenes de trabajo', cotizaciones: 'Cotizaciones', almacenamiento: 'Almacenamiento (MB)' } as const

export function VistaUso({ datos, ajustados }: { datos: UsoTenant; ajustados?: Partial<Record<string, number>> }) {
  const [serie, setSerie] = useState<keyof typeof SERIES>('api')
  return (
    <>
      <Cifras
        cifras={[
          { rotulo: 'Órdenes de trabajo (total)', valor: cifra(datos.totales.ots) },
          { rotulo: 'Cotizaciones', valor: cifra(datos.totales.cotizaciones) },
          { rotulo: 'Documentos', valor: cifra(datos.totales.documentos) },
          { rotulo: 'Mensajes', valor: cifra(datos.totales.mensajes) },
          { rotulo: 'Llamadas a la API', valor: cifraCorta(datos.totales.api) },
          { rotulo: 'Almacenamiento', valor: megas(datos.serie.at(-1)?.almacenamiento ?? 0) },
        ]}
      />
      <div className="columnas">
        <Bloque titulo="Consumo del plan · este mes">
          <div style={{ margin: '-12px -14px' }}>
            <TablaLimites usos={datos.usos} ajustados={ajustados} />
          </div>
        </Bloque>
        <Bloque titulo="Uso de funciones clave · 30 días">
          <div style={{ margin: '-12px -14px' }}>
            <Table
              size="small"
              rowKey="clave"
              pagination={false}
              dataSource={[...datos.funciones].sort((a, b) => b.usos30d - a.usos30d)}
              columns={[
                { title: 'Función', dataIndex: 'nombre' },
                { title: 'Usos', dataIndex: 'usos30d', align: 'right', render: (v: number) => (v ? cifra(v) : <Estado tono="gris">Sin uso</Estado>) },
              ]}
            />
          </div>
        </Bloque>
      </div>
      <Bloque
        titulo={`${SERIES[serie]} por día · 90 días`}
        extra={<Segmented size="small" value={serie} onChange={(v) => setSerie(v as typeof serie)} options={Object.entries(SERIES).map(([value, label]) => ({ value, label: label.replace(' (MB)', '') }))} />}
      >
        <Barras nombre={SERIES[serie]} datos={datos.serie.map((d) => ({ etiqueta: diaCorto(d.dia), valor: d[serie] }))} formato={serie === 'almacenamiento' ? megas : cifraCorta} />
      </Bloque>
    </>
  )
}

export function VistaFacturacion({ datos }: { datos: FacturacionTenant }) {
  const monto = datos.mrr ?? datos.montoMensual ?? 0
  const ultima = datos.facturas[0]
  return (
    <>
      <Cifras
        cifras={[
          { rotulo: 'Plan', valor: PLANES[datos.plan].nombre, nota: datos.precioPlan !== undefined && datos.precioPlan !== monto ? `Lista: ${plata(datos.precioPlan)}` : undefined },
          { rotulo: 'Monto mensual', valor: plata(monto) },
          { rotulo: 'Estado de pago', valor: <PagoTag estado={datos.estadoPago} /> },
          { rotulo: 'Próximo cobro', valor: fecha(datos.proximoCobro) },
          { rotulo: 'Última factura', valor: ultima ? plata(ultima.monto) : '—', nota: ultima ? `${ultima.numero} · ${fecha(ultima.emitida)}` : undefined },
          { rotulo: 'Correo de facturación', valor: <span style={{ fontSize: 13, fontWeight: 500 }}>{datos.correo}</span> },
        ]}
      />
      <Bloque titulo="Historial de pagos">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={datos.facturas}
          scroll={{ x: 720 }}
          locale={{ emptyText: 'Sin facturas: el plan no tiene cobro.' }}
          columns={[
            { title: 'Factura', dataIndex: 'numero', render: (v: string) => <span className="mono">{v}</span> },
            { title: 'Emitida', dataIndex: 'emitida', render: (v: string) => fecha(v) },
            { title: 'Vence', dataIndex: 'vence', render: (v: string) => fecha(v) },
            { title: 'Monto', dataIndex: 'monto', align: 'right', render: (v: number) => plata(v) },
            { title: 'Estado', dataIndex: 'estado', render: (v: FacturacionTenant['facturas'][number]['estado']) => <FacturaTag estado={v} /> },
            { title: 'Pagada', dataIndex: 'pagada', render: (v: string | null, f) => (v ? fecha(v) : f.motivoFalla ? <span className="detalle">{f.motivoFalla}</span> : <span className="tenue">—</span>) },
          ]}
        />
      </Bloque>
      {datos.eventos && (
        <Bloque titulo="Eventos de facturación y plan">
          <TablaEventos filas={datos.eventos} compacta />
        </Bloque>
      )}
    </>
  )
}

export function VistaIntegraciones({ datos }: { datos: Integraciones }) {
  return (
    <>
      <Bloque titulo="Integraciones">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={datos.integraciones}
          scroll={{ x: 760 }}
          locale={{ emptyText: 'Sin integraciones.' }}
          columns={[
            { title: 'Integración', key: 'n', render: (_, i) => <div className="fila-nombre"><b>{i.nombre}</b><small>{TIPOS_INTEGRACION[i.tipo]}</small></div> },
            { title: 'Destino', dataIndex: 'destino', render: (v: string) => <span className="mono">{v}</span> },
            { title: 'Estado', dataIndex: 'estado', render: (v: Integraciones['integraciones'][number]['estado']) => <IntegracionTag estado={v} /> },
            { title: 'Último envío correcto', dataIndex: 'ultimoExito', render: (v: string | null) => <Hace iso={v} /> },
            { title: 'Último error', key: 'e', render: (_, i) => (i.ultimoError ? <span className="detalle">{i.ultimoError} · <Hace iso={i.ultimaFalla} /></span> : <span className="tenue">—</span>) },
          ]}
        />
      </Bloque>
      <Bloque titulo="Claves de API">
        <TablaClaves claves={datos.clavesApi} />
      </Bloque>
    </>
  )
}

function TablaClaves({ claves }: { claves: Integraciones['clavesApi'] }) {
  return (
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={claves}
      locale={{ emptyText: 'Sin claves de API.' }}
      columns={[
        { title: 'Nombre', dataIndex: 'nombre' },
        { title: 'Prefijo', dataIndex: 'prefijo', render: (v: string) => <span className="mono">{v}…</span> },
        { title: 'Creada', dataIndex: 'creada', render: (v: string) => fecha(v) },
        { title: 'Último uso', dataIndex: 'ultimoUso', render: (v: string | null) => <Hace iso={v} /> },
        { title: 'Estado', key: 'e', render: (_, k) => (k.revocada ? <Estado tono="gris">Revocada {fecha(k.revocada)}</Estado> : <Estado tono="verde">Activa</Estado>) },
      ]}
    />
  )
}

export function VistaSeguridad({ datos, verCompleto }: { datos: SeguridadTenant; verCompleto?: React.ReactNode }) {
  const activas = datos.clavesApi.filter((k) => !k.revocada).length
  return (
    <>
      <Cifras
        cifras={[
          { rotulo: 'Ingresos fallidos 24 h', valor: cifra(datos.fallidos.h24), tono: datos.fallidos.h24 >= 10 ? 'rojo' : undefined },
          { rotulo: 'Fallidos 7 días', valor: cifra(datos.fallidos.d7) },
          { rotulo: 'Fallidos 30 días', valor: cifra(datos.fallidos.d30) },
          { rotulo: 'MFA', valor: `${cifra(datos.mfa.conMfa)} de ${cifra(datos.mfa.total)}`, nota: datos.mfaObligatorio ? 'Obligatorio para todos' : 'Opcional' },
          { rotulo: 'SSO', valor: datos.sso.activo ? 'Activo' : 'No', nota: datos.sso.proveedor ?? undefined },
          { rotulo: 'Claves de API activas', valor: cifra(activas) },
        ]}
      />
      <div className="columnas">
        <Bloque titulo="IPs recientes · 30 días" extra={verCompleto}>
          <div style={{ margin: '-12px -14px' }}>
            <Table
              size="small"
              rowKey={(i) => `${i.ip}-${i.pais}`}
              pagination={datos.ips.length > 10 ? { pageSize: 10, size: 'small' } : false}
              dataSource={datos.ips}
              columns={[
                { title: 'IP', dataIndex: 'ip', render: (v: string) => <span className="mono">{v}</span> },
                { title: 'Ubicación', key: 'u', render: (_, i) => [i.ciudad, i.pais].filter(Boolean).join(', ') },
                { title: 'Ingresos', dataIndex: 'inicios', align: 'right' },
                { title: 'Fallidos', dataIndex: 'fallidos', align: 'right', render: (v: number) => (v >= 10 ? <b style={{ color: 'var(--rojo)' }}>{v}</b> : v) },
                { title: 'Último', dataIndex: 'ultimo', render: (v: string) => <Hace iso={v} /> },
              ]}
            />
          </div>
        </Bloque>
        <Bloque titulo="Países de acceso · 30 días">
          <div style={{ margin: '-12px -14px' }}>
            <Table
              size="small"
              rowKey="pais"
              pagination={false}
              dataSource={datos.paises}
              columns={[
                { title: 'País', dataIndex: 'pais' },
                { title: 'Ingresos', dataIndex: 'inicios', align: 'right', render: (v: number) => cifra(v) },
                { title: 'Fallidos', dataIndex: 'fallidos', align: 'right', render: (v: number) => cifra(v) },
              ]}
            />
          </div>
        </Bloque>
      </div>
      <Bloque titulo="Ingresos fallidos recientes">
        <TablaEventos filas={datos.fallidosRecientes} compacta />
      </Bloque>
      <div className="columnas">
        <Bloque titulo="Claves de API">
          <TablaClaves claves={datos.clavesApi} />
        </Bloque>
        <Bloque titulo="Cambios de rol">
          <TablaEventos filas={datos.cambiosDeRol} compacta />
        </Bloque>
      </div>
      <Bloque titulo="Eventos sensibles · seguridad, datos y soporte">
        <TablaEventos filas={datos.sensibles} />
      </Bloque>
    </>
  )
}

/** La auditoría de un cliente, filtrable por categoría y paginada. `ruta` es la de la consola o la del panel. */
export function VistaAuditoria({ ruta, clave, completo }: { ruta: string; clave: unknown[]; completo?: boolean }) {
  const [filtros, setFiltros] = useState<{ categoria?: Categoria[]; pagina: number; porPagina: number }>({ pagina: 1, porPagina: 50 })
  const r = useQuery({
    queryKey: [...clave, 'eventos', filtros, completo],
    queryFn: () => api<PaginaEventos>('GET', `${ruta}${consulta({ ...filtros, completo: completo ? 1 : undefined })}`),
    placeholderData: keepPreviousData,
  })
  return (
    <Bloque
      titulo="Registro de eventos"
      extra={
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          placeholder="Todas las categorías"
          style={{ minWidth: 240 }}
          value={filtros.categoria ?? []}
          options={Object.entries(CATEGORIAS).map(([value, label]) => ({ value, label }))}
          onChange={(v) => setFiltros({ ...filtros, categoria: v.length ? (v as Categoria[]) : undefined, pagina: 1 })}
        />
      }
    >
      {r.isError && <Problema error={r.error} />}
      <TablaEventos
        filas={r.data?.filas ?? []}
        cargando={r.isFetching}
        paginacion={{ total: r.data?.total ?? 0, pagina: filtros.pagina, porPagina: filtros.porPagina, cambiar: (pagina, porPagina) => setFiltros({ ...filtros, pagina, porPagina }) }}
      />
    </Bloque>
  )
}
