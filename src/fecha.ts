// Una fecha de calendario como llega de las pantallas: «2026-11-14». Sin servidor: lo usan las reglas y las rutas.
import { z } from 'zod'

/** Que el día exista: «2026-02-31» o «2026-13-01» tienen la forma, pero no son días. */
export function diaValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false
  const d = new Date(`${dia}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia
}

/** Un día del calendario, revisado: la forma y que exista. */
export const diaSchema = z.string().refine(diaValido, 'La fecha no es válida: va como AAAA-MM-DD y tiene que existir.')
