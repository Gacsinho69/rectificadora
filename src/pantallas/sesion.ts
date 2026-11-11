import { useQuery } from '@tanstack/react-query'
import type { Actor, PersonaDelTenant } from '../modulos/acceso/identidad'
import { api } from './api'

export type Yo = { actor: Actor | null; impersonacion: PersonaDelTenant | null }

/** Quién está dentro, y si es del equipo, como quién está entrando (si está impersonando). */
export const useYo = () => useQuery({ queryKey: ['yo'], queryFn: () => api<Yo>('GET', '/yo'), staleTime: 60_000 })
