# Node.js 20 LTS Debian slim base
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production runtime stage
FROM node:20-slim AS runner

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    INTERNAL_BASE_URL=http://127.0.0.1:3000

COPY package*.json ./
RUN npm ci --omit=dev

# Copy built server and web bundle
COPY --from=builder /app/dist ./dist
COPY brand_menu_items_local.json ./brand_menu_items_local.json

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/status || exit 1

CMD ["node", "dist/server.cjs"]
