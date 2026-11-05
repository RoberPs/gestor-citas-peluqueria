# The application image. One process per salon, which is what the in-memory
# rate limiter requires (D-007). How it is built, published and run on the
# shared VPS: deploy/README.md.
#
# The version is mandatory and must be package.json's; otherwise the build
# fails. The tag is that same version, never `latest`:
#
#   docker build --build-arg APP_VERSION=X.Y.Z -t ghcr.io/roberps/gestor-citas-peluqueria:X.Y.Z .
#
# Base image pinned by digest: the same base in both stages and in every build.
# It is the multi-platform index, the one the chatbot on the same VPS already
# runs. To move it: `docker buildx imagetools inspect node:22-slim` (field
# «Digest»), change it here, rebuild, pass the tests and publish a new version.
ARG NODE_IMAGE=node:22-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

FROM ${NODE_IMAGE} AS build
ARG APP_VERSION
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN version="$(node -p "require('./package.json').version")" \
  && if [ "${APP_VERSION:-}" != "$version" ]; then \
       echo "APP_VERSION must be package.json's version ($version), got '${APP_VERSION:-}'" >&2; exit 1; \
     fi
RUN npm ci
COPY . .
# `public/` holds only a .gitkeep, which the allowlist may leave out.
RUN mkdir -p public && npm run build && npm run build:cli

FROM ${NODE_IMAGE}
ARG APP_VERSION
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.source=https://github.com/RoberPs/gestor-citas-peluqueria
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Docker sets HOSTNAME to the container id, and Next's standalone server
    # listens on whatever HOSTNAME says: without this it would not answer on
    # the network the proxy reaches it by.
    HOSTNAME=0.0.0.0
# This stage only ever runs `node`: npm, npx and corepack go, one tool and a
# handful of advisories fewer for whoever gets into the container.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
# Owned by root and the container runs as `node`: the code cannot be changed
# from inside, even before the compose makes the root filesystem read-only.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The commands of deploy/README.md (`node cli/migrate.mjs`, …) and the SQL
# that `migrate` reads from ../src/infrastructure/db/migrations.
COPY --from=build /app/cli ./cli
COPY --from=build /app/src/infrastructure/db/migrations ./src/infrastructure/db/migrations
# The one directory Next writes to. The compose mounts a tmpfs over it.
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
# Healthy is the process answering and its database too (/health). There is no
# curl in the image: node asks. `--start-interval` needs Docker Engine 25+.
HEALTHCHECK --start-period=30s --start-interval=5s --interval=30s --timeout=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
