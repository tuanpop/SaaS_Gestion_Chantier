# ============================================================
# ClawBTP — Dockerfile multi-stage Next.js 15
# ============================================================
# PRÉREQUIS : next.config.js DOIT contenir output: 'standalone'
# Sans ce flag, l'étape runner ne trouvera pas .next/standalone.
# Ajouter dans next.config.js :
#   const nextConfig = { output: 'standalone', ... }
# ============================================================

# -----------------------------------------------------------
# Stage 1 : deps — installe uniquement les dépendances de prod
# -----------------------------------------------------------
FROM node:22-alpine AS deps
# libc6-compat requis pour certains binaires natifs (ioredis, file-type)
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json package-lock.json* ./
# npm ci garantit un install reproductible depuis lockfile
RUN npm ci --omit=dev

# -----------------------------------------------------------
# Stage 2 : builder — build Next.js avec toutes les devDeps
# -----------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copier node_modules de prod depuis deps
COPY --from=deps /app/node_modules ./node_modules
# Installer aussi les devDeps pour le build (typescript, eslint, etc.)
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Variables de build nécessaires à next build
# Ces variables sont substituées au build-time — pas de secrets serveur ici
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_VAPID_KEY

ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_VAPID_KEY=${NEXT_PUBLIC_VAPID_KEY}

# Désactiver la télémétrie Next.js
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# -----------------------------------------------------------
# Stage 3 : runner — image de production minimale
# -----------------------------------------------------------
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat curl
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Utilisateur non-root pour limiter la surface d'attaque
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copier uniquement l'output standalone (pas node_modules entier)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# curl utilisé pour le healthcheck Docker interne
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
