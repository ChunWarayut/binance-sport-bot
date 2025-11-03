FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb* /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

# Install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lockb* /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

# Copy node_modules and source code into final image
FROM base AS release
COPY --from=install /temp/prod/node_modules /app/node_modules
COPY package.json /app/package.json
COPY tsconfig.json /app/tsconfig.json
COPY drizzle.config.ts /app/drizzle.config.ts
COPY src /app/src
COPY public /app/public

# Copy migrations if exists, otherwise create empty directory
COPY migrations /app/migrations

# Expose port
EXPOSE 3000

# Run the app directly with Bun (no build needed)
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
