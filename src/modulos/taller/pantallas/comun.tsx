// Piezas del sistema de la rectificadora: estados con su color, la barra de avance, el plazo y quién puede qué.
import { useParams } from '@tanstack/react-router'
import { Estado, type Tono } from '../../../pantallas/componentes'
import { useYo } from '../../../pantallas/sesion'
import type { PersonaDelTenant } from '../../acceso/identidad'
import { ESTADOS_COTIZACION, type EstadoCotizacion } from '../../comercial/reglas'
import { ESTADOS_OT, ESTADOS_TAREA, type EstadoOt, type EstadoTarea } from '../reglas'

const TONO_OT: Record<EstadoOt, Tono> = { received: 'gris', diagnosis: 'azul', waiting_approval: 'dorado', in_progress: 'azul', quality: 'naranjo', ready: 'verde', delivered: 'gris', cancelled: 'gris' }
const TONO_TAREA: Record<EstadoTarea, Tono> = { pending: 'gris', in_progress: 'azul', done: 'verde' }
const TONO_COT: Record<EstadoCotizacion, Tono> = { draft: 'gris', sent: 'dorado', accepted: 'verde', rejected: 'rojo', cancelled: 'gris' }

export const EstadoOtTag = ({ estado }: { estado: EstadoOt }) => <Estado tono={TONO_OT[estado]}>{ESTADOS_OT[estado]}</Estado>
export const EstadoTareaTag = ({ estado }: { estado: EstadoTarea }) => <Estado tono={TONO_TAREA[estado]}>{ESTADOS_TAREA[estado]}</Estado>
export const EstadoCotTag = ({ estado }: { estado: EstadoCotizacion }) => <Estado tono={TONO_COT[estado]}>{ESTADOS_COTIZACION[estado]}</Estado>

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
  }
}
