# El sistema en un contenedor, para cualquier proveedor que corra Docker (Fly.io, Railway, Render, Google Cloud Run,
# un servidor propio). La base PostgreSQL va aparte; el contenedor no guarda nada propio y se puede reemplazar cuando sea.
#
#   docker build -t rectificadora .
#   docker run -p 3000:3000 -e DATABASE_URL=postgres://… -e DOMINIO_PLATAFORMA=rectificadora.cl rectificadora

# 1) Compilar las pantallas y el servidor.
FROM node:24-slim AS armado
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 2) Lo que corre: solo las dependencias de producción, lo compilado y las migraciones.
FROM node:24-slim
ENV NODE_ENV=production \
    TZ=America/Santiago \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=armado /app/dist ./dist
COPY --from=armado /app/dist-servidor ./dist-servidor
COPY drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/salud').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist-servidor/servidor.js"]
