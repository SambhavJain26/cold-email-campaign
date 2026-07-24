# syntax=docker/dockerfile:1
# Production image (B7.5, docs/16 §2). Multi-stage:
#   base      - full workspace install (server runs via tsx; shared is raw TS)
#   web-build - the static SPA, built in real-API mode
#   app       - API + workers (target: app)
#   caddy     - TLS terminator that serves the SPA and proxies /api (target: caddy)

FROM node:22-slim AS base
WORKDIR /app
COPY . .
RUN npm ci

# --- SPA: real API mode disables MSW; the bundle calls same-origin /api/v1 ---
FROM base AS web-build
ENV VITE_API_MODE=real
RUN npm run build -w @coldemail/web

# --- app: runs migrations then boots (see docker/app-entrypoint.sh) ---
FROM base AS app
ENV NODE_ENV=production
COPY docker/app-entrypoint.sh /usr/local/bin/app-entrypoint.sh
RUN chmod +x /usr/local/bin/app-entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["/usr/local/bin/app-entrypoint.sh"]

# --- caddy: auto-TLS, serves the built SPA, reverse-proxies /api + /health ---
FROM caddy:2 AS caddy
COPY --from=web-build /app/apps/web/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
