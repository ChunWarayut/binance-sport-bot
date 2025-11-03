# syntax=docker/dockerfile:1.6

FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies once using cached Bun downloads
FROM base AS install
COPY package.json bun.lockb* ./
RUN --mount=type=cache,target=/root/.bun bun install --frozen-lockfile --production

# Copy node_modules and source code into final image
FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY package.json ./package.json
COPY bun.lockb* ./bun.lockb

COPY tsconfig.json ./tsconfig.json
COPY drizzle.config.ts ./drizzle.config.ts
COPY src ./src
COPY public ./public

# Copy migrations if exists, otherwise create empty directory
COPY migrations ./migrations

# Expose port
EXPOSE 3000

# Run the app directly with Bun (no build needed)
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
