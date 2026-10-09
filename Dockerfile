# ==============================================================================
# Dockerfile Multi-stage pour Bko_backend (Express + Prisma + TypeScript)
# ==============================================================================

# Stage 1: Build & Compilation TypeScript
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Dépendances système pour OpenSSL (requis par Prisma)
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Cache des dépendances npm
COPY package*.json ./
COPY prisma ./prisma/
COPY scripts ./scripts/
RUN node scripts/verify-migrations.cjs

RUN npm ci --include=dev

# Génération des binaires Prisma Client adaptés à l'architecture Linux
RUN npx prisma generate

# Copie des sources et compilation
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Stage 2: Runtime Production
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update && apt-get install -y openssl ca-certificates dumb-init curl wget && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/
COPY scripts ./scripts/
RUN node scripts/verify-migrations.cjs

# Dépendances de production + outils CLI pour les migrations automatiques
RUN npm ci --only=production && \
    npm install -g prisma@5.22.0 tsx@4.19.2

# Copie des artefacts compilés et du client Prisma généré
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Script d'entrypoint gérant la santé de la BD, les migrations et le seed
COPY docker-entrypoint.sh ./
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/usr/bin/dumb-init", "--", "./docker-entrypoint.sh"]
CMD ["node", "dist/app.js"]
