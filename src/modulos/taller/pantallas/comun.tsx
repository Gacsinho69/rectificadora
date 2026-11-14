// Piezas del sistema de la rectificadora: estados con su color, la situación de un trabajo en su ruta, la barra de
// avance, el plazo y quién puede qué.
import { useParams } from '@tanstack/react-router'
import { Form, InputNumber, Select } from 'antd'
import { Estado, type Tono } from '../../../pantallas/componentes'
import { useYo } from '../../../pantallas/sesion'
import type { PersonaDelTenant } from '../../acceso/identidad'
import { ESTADOS_COTIZACION, type EstadoCotizacion } from '../../comercial/reglas'
import { ESTADOS_OC, type EstadoOc, type EstadoRepuesto, estadoDeRepuesto, type QuienCompra } from '../../compras/reglas'
import { CILINDROS, type Criterio, CRITERIOS, ESTADOS_OT, ESTADOS_TAREA, type EstadoOt, type EstadoTarea, MOTIVOS_DETENCION, type Motor, MOTOR_POR_OMISION, SITUACIONES, type Situacion } from '../reglas'
import type { Funcion } from '../../tenants/reglas'
import type { Detencion } from './tipos'

const TONO_OT: Record<EstadoOt, Tono> = { received: 'gris', diagnosis: 'azul', waiting_approval: 'dorado', in_progress: 'azul', quality: 'naranjo', ready: 'verde', delivered: 'gris', cancelled: 'gris' }
const TONO_TAREA: Record<EstadoTarea, Tono> = { pending: 'gris', in_progress: 'azul', done: 'verde' }
const TONO_COT: Record<EstadoCotizacion, Tono> = { draft: 'gris', sent: 'dorado', accepted: 'verde', rejected: 'rojo', cancelled: 'gris' }
const TONO_SITUACION: Record<Situacion, Tono> = { in_progress: 'azul', available: 'gris', parts: 'dorado', machine: 'naranjo', waiting: 'gris', held: 'naranjo', done: 'verde' }
const TONO_REPUESTO: Record<EstadoRepuesto, Tono> = { pending: 'dorado', ordered: 'azul', received: 'verde', cancelled: 'gris' }
const TONO_OC: Record<EstadoOc, Tono> = { open: 'azul', received: 'verde', cancelled: 'gris' }

export const EstadoOtTag = ({ estado }: { estado: EstadoOt }) => <Estado tono={TONO_OT[estado]}>{ESTADOS_OT[estado]}</Estado>
export const EstadoTareaTag = ({ estado }: { estado: EstadoTarea }) => <Estado tono={TONO_TAREA[estado]}>{ESTADOS_TAREA[estado]}</Estado>
export const EstadoCotTag = ({ estado }: { estado: EstadoCotizacion }) => <Estado tono={TONO_COT[estado]}>{ESTADOS_COTIZACION[estado]}</Estado>
/** «Por pedir», «Pedido», «Lo trae el cliente», «Recibido». */
export const EstadoRepuestoTag = ({ compra, estado }: { compra: QuienCompra; estado: EstadoRepuesto }) => <Estado tono={TONO_REPUESTO[estado]}>{estadoDeRepuesto({ compra, estado })}</Estado>
export const EstadoOcTag = ({ estado }: { estado: EstadoOc }) => <Estado tono={TONO_OC[estado]}>{ESTADOS_OC[estado]}</Estado>

/** «a», «a y b», «a, b y c». */
export const enumerar = (l: string[]) => (l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} y ${l.at(-1)}`)

/** Dónde está un trabajo en su ruta. Detenido dice por qué; lo que espera dice qué espera al pasar el mouse. */
export function SituacionTag({ situacion, detencion, espera, faltan, maquinas }: { situacion: Situacion; detencion?: Detencion | null; espera?: string[]; faltan?: string[]; maquinas?: string[] }) {
  if (situacion === 'held' && detencion) return <Estado tono="naranjo" titulo={detencion.nota ?? undefined}>{MOTIVOS_DETENCION[detencion.motivo]}</Estado>
  const titulo = situacion === 'machine' && maquinas?.length ? `Máquina detenida: ${enumerar(maquinas)}` : situacion === 'parts' && faltan?.length ? `Faltan: ${enumerar(faltan)}` : situacion === 'waiting' && espera?.length ? `Espera: ${enumerar(espera)}` : undefined
  return (
    <Estado tono={TONO_SITUACION[situacion]} titulo={titulo}>
      {SITUACIONES[situacion]}
    </Estado>
  )
}

/** Los repuestos que le faltan a un trabajo, en una línea: «Faltan: Kit de pistones». */
export const textoFaltan = (faltan: string[]) => `Faltan: ${faltan.length > 2 ? `${faltan.slice(0, 2).join(', ')} y ${faltan.length - 2} más` : enumerar(faltan)}`

/** Las máquinas detenidas que necesita un trabajo, en una línea: «Máquina detenida: Lineadora de bancada (en mantención)». */
export const textoMaquinas = (maquinas: string[]) => `Máquina detenida: ${enumerar(maquinas)}`

/** Qué espera un trabajo, en una línea: «Espera: Cepillado de culata». */
export const textoEspera = (espera: string[]) => (espera.length > 2 ? `Espera: ${espera.slice(0, 2).join(', ')} y ${espera.length - 2} más` : `Espera: ${enumerar(espera)}`)

/** Cómo se contó una línea o un trabajo: «6 · por cilindro»; lo que va una vez no lo dice. */
export const comoSeCuenta = (criterio: Criterio | null | undefined) => (criterio && criterio !== 'fixed' ? CRITERIOS[criterio].toLowerCase() : null)

export function PlazoTag({ plazo }: { plazo: 'atrasada' | 'por_vencer' | null | undefined }) {
  if (!plazo) return null
  return plazo === 'atrasada' ? <Estado tono="rojo">Atrasada</Estado> : <Estado tono="naranjo">Por vencer</Estado>
}

/** El avance de una OT: azul mientras falta, verde al completar. */
export function Avance({ fraccion, ancho = 80 }: { fraccion: number; ancho?: number }) {
  return (
    <span className="medidor" title={`${Math.round(fraccion * 100)} % hecho`}>
      <span className={`medidor-barra ${fraccion >= 1 ? 'verde' : 'azul'}`} style={{ width: ancho }}>
        <span style={{ width: `${Math.min(100, fraccion * 100)}%` }} />
      </span>
      <span className="medidor-valor">{Math.round(fraccion * 100)} %</span>
    </span>
  )
}

/** El avance de una OT en una lista: antes de aprobarse solo hay diagnóstico, así que se dice la etapa y no un porcentaje. */
export function AvanceOt({ estado, fraccion, ancho }: { estado: EstadoOt; fraccion: number; ancho?: number }) {
  if (estado === 'received' || estado === 'diagnosis') return <span className="tenue">Diagnóstico</span>
  if (estado === 'waiting_approval') return <span className="tenue">Por aprobar</span>
  if (estado === 'cancelled') return <span className="tenue">—</span>
  return <Avance fraccion={fraccion} ancho={ancho} />
}

/** Horas con un decimal, a la chilena: «1,5 h». */
export const horas = (h: number) => `${h.toLocaleString('es-CL', { maximumFractionDigits: 1 })} h`
/** Días de cola: «0,5 días», «sin gente». */
export const dias = (d: number | null) => (d === null ? 'sin gente' : `${d.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ${d === 1 ? 'día' : 'días'}`)

/** Lo que se sabe del motor; lo que falta, con lo más común. */
export const motorDeDatos = (x: { cilindros: number | null; valvulasPorCilindro: number | null; culatas: number | null }): Motor => ({
  cilindros: x.cilindros ?? MOTOR_POR_OMISION.cilindros,
  valvulasPorCilindro: x.valvulasPorCilindro ?? MOTOR_POR_OMISION.valvulasPorCilindro,
  culatas: x.culatas ?? MOTOR_POR_OMISION.culatas,
})

/**
 * «6 cilindros · 24 válvulas · 1 culata», o null si no se sabe nada. Lo que falta se dice como se cuenta (con lo más
 * común) y avisa que es supuesto: así la pantalla dice lo mismo que se cobra.
 */
export function textoMotor(x: { cilindros: number | null; valvulasPorCilindro: number | null; culatas: number | null }) {
  if (!x.cilindros && !x.valvulasPorCilindro && !x.culatas) return null
  const m = motorDeDatos(x)
  const supuesto = (v: number | null) => (v ? '' : ' (sin dato)')
  const partes = [`${m.cilindros} cilindros${supuesto(x.cilindros)}`]
  if (x.valvulasPorCilindro || x.cilindros) partes.push(`${m.cilindros * m.valvulasPorCilindro} válvulas (${m.valvulasPorCilindro} por cilindro${x.valvulasPorCilindro ? '' : ', sin dato'})`)
  if (x.culatas) partes.push(x.culatas === 1 ? '1 culata' : `${x.culatas} culatas`)
  return partes.join(' · ')
}

/** Cilindros, válvulas por cilindro y culatas: con esto se cuentan las actividades al cotizar. */
export function CamposDelMotor() {
  return (
    <div className="columnas-3">
      <Form.Item label="Cilindros" name="cilindros">
        <Select allowClear placeholder="No sé" options={CILINDROS.map((n) => ({ value: n, label: String(n) }))} />
      </Form.Item>
      <Form.Item label="Válvulas por cilindro" name="valvulasPorCilindro">
        <Select allowClear placeholder="No sé" options={[2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
      </Form.Item>
      <Form.Item label="Culatas" name="culatas">
        <InputNumber min={1} max={24} placeholder="1" style={{ width: '100%' }} />
      </Form.Item>
    </div>
  )
}

/** Dónde retira el chofer una orden de compra: la dirección del proveedor y su teléfono, que en el celular se marca con un toque. */
export function DondeRetirar({ direccion, telefono }: { direccion: string | null; telefono: string | null }) {
  if (!direccion && !telefono) return null
  return (
    <small className="retiro-donde">
      {direccion}
      {direccion && telefono ? ' · ' : ''}
      {telefono && <a href={`tel:${telefono.replace(/[^+\d]/g, '')}`}>{telefono}</a>}
    </small>
  )
}

export const folioOt = (n: number) => `OT-${String(n).padStart(4, '0')}`
export const folioCot = (n: number) => `COT-${String(n).padStart(4, '0')}`

/** La dirección del portal abierto (`/c/<subdominio>`), para armar los enlaces. */
export function usePortal() {
  const { portal } = useParams({ strict: false }) as { portal?: string }
  return portal ?? ''
}

/** Quién está dentro del sistema de la rectificadora (la persona, o soporte entrando como ella) y qué puede hacer. */
export function usePersona() {
  const yo = useYo()
  const persona: PersonaDelTenant | null = yo.data?.actor?.tipo === 'tenant' ? yo.data.actor : (yo.data?.impersonacion ?? null)
  const rol = persona?.rol
  return {
    persona,
    gestiona: rol === 'admin' || rol === 'planner',
    veMontos: Boolean(rol && rol !== 'technician'),
    trabaja: Boolean(rol && rol !== 'viewer'),
    esAdmin: rol === 'admin',
    suspendida: persona?.estadoTenant === 'suspended',
    /** Si su organización tiene encendido ese módulo (compras, bodega, máquinas). */
    tiene: (f: Funcion) => Boolean(persona?.funciones?.includes(f)),
  }
}
