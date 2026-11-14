// Los mensajes de Zod en castellano: un campo que se pasa de largo dice «Demasiado grande…» y no «Too big…». Se
// importa primero en el servidor y en las pantallas; los esquemas con su propio mensaje lo siguen usando.
import { z } from 'zod'

z.config(z.locales.es())
