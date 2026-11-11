import { defineConfig } from 'drizzle-kit'

export default defineConfig({ dialect: 'postgresql', schema: './src/esquema.ts', out: './drizzle', casing: 'snake_case' })
