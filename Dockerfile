# Imagen de producción: custom server Next.js + Socket.io + Prisma.
FROM node:20-slim AS base

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY prisma ./prisma
RUN npx prisma generate

# Las variables NEXT_PUBLIC se inlinean en el bundle: deben estar disponibles
# durante el build ( Compose las pasa como build args desde .env ).
ARG DATABASE_URL="file:./dev.db"
ARG NEXT_PUBLIC_APP_URL="http://localhost:3000"
ARG NEXT_PUBLIC_LOGROCKET_APP_ID=""
ENV DATABASE_URL=$DATABASE_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_LOGROCKET_APP_ID=$NEXT_PUBLIC_LOGROCKET_APP_ID

COPY next.config.mjs tsconfig.json postcss.config.mjs tailwind.config.ts ./
COPY src ./src
COPY server.js ./
RUN npm run build && mkdir -p uploads && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["npm", "start"]
