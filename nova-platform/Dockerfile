FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build
WORKDIR /app
RUN apt-get update -qq && apt-get install -y --no-install-recommends -qq openssl ca-certificates && apt-get clean
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run build

FROM build AS application
ENV NODE_ENV=production
RUN mkdir -p /var/lib/nova-hls /var/lib/nova-health && chown node:node /var/lib/nova-hls /var/lib/nova-health
USER node
CMD ["node","--import","./scripts/load-secrets.mjs","apps/api/dist/main.js"]

FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS media-base
WORKDIR /app
RUN apt-get update -qq && apt-get install -y --no-install-recommends -qq ffmpeg openssl ca-certificates && apt-get clean
ENV NODE_ENV=production

FROM media-base AS media-worker
COPY --from=build /app /app
RUN mkdir -p /var/lib/nova-hls && chown node:node /var/lib/nova-hls
USER node
CMD ["node","--import","./scripts/load-secrets.mjs","scripts/media-worker.mjs"]

FROM media-worker AS media-health
USER root
RUN mkdir -p /var/lib/nova-health && chown node:node /var/lib/nova-health
USER node
CMD ["node","--import","./scripts/load-secrets.mjs","scripts/stream-health-worker.mjs"]

FROM caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d AS gateway
COPY --from=build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile

FROM media-base AS restream-worker
COPY --from=build /app /app
USER node
CMD ["node","--import","./scripts/load-secrets.mjs","scripts/restream-worker.mjs"]
