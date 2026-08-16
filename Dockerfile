FROM node:24.15.0-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build:vps

FROM node:24.15.0-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV INKSTONE_DATA_DIR=/data

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/scripts/start-vps.mjs /app/scripts/vps-scheduler.mjs ./scripts/

RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 7712
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:7712/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "scripts/start-vps.mjs"]
