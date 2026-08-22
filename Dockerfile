# syntax=docker/dockerfile:1
# Production image (B7.5, docs/16 §2). Multi-stage:
#   base      — full workspace install (server runs via tsx; shared is raw TS)
#   web-build — the static SPA, built in real-API mode
#   app       — API + workers (target: app)
#   caddy     — TLS terminator that serves the SPA and proxies /api (target: caddy)

FROM node:22-slim AS base
WORKDIR /app
COPY . .
RUN npm ci

# --- SPA: real API mode disables MSW; the bundle calls same-origin /api/v1 ---
FROM base AS web-build
ENV VITE_API_MODE=real
ARG VITE_APP_BASE=/
ENV VITE_APP_BASE=$VITE_APP_BASE
RUN npm run build -w @coldemail/web

# --- app: runs migrations then boots (see docker/app-entrypoint.sh) ---
FROM base AS app
ENV NODE_ENV=production
RUN npm prune --omit=dev
COPY docker/app-entrypoint.sh /usr/local/bin/app-entrypoint.sh
RUN chmod +x /usr/local/bin/app-entrypoint.sh
EXPOSE 3001
# Liveness: /health returns { ok } once the DB is reachable (no curl in slim).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>r.json()).then(b=>process.exit(b.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/app-entrypoint.sh"]

# --- caddy: auto-TLS, serves the built SPA, reverse-proxies /api + /health ---
FROM caddy:2 AS caddy
COPY --from=web-build /app/apps/web/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile

# Existing-VPS deployment: plain HTTP gateway bound to host loopback. Host
# Caddy remains the sole public TLS listener and owns every public hostname.
FROM caddy AS spaceship-gateway
COPY docker/Caddyfile.spaceship /etc/caddy/Caddyfile
