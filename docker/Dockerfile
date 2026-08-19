# ---------- Stage 1: build ----------
FROM node:20-alpine AS build
WORKDIR /app

# Install ALL deps (incl. dev) using the lockfile for reproducibility.
COPY package.json package-lock.json* ./
RUN npm ci

# Compile TypeScript -> dist (includes data-source + migrations).
COPY . .
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Only production dependencies in the final image.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output.
COPY --from=build /app/dist ./dist

# Run as an unprivileged user (the node:alpine image ships a `node` user).
USER node

EXPOSE 3000

# Liveness for orchestrators / compose.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/live > /dev/null 2>&1 || exit 1

# Apply migrations, then start the compiled server.
CMD ["sh", "-c", "npm run migration:run:prod && node dist/main"]
