# The application image. One process per salon, which is what the in-memory
# rate limiter requires (D-007).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time environment only: the real values arrive at run time.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json ./
COPY next.config.ts tsconfig.json ./
COPY src ./src
COPY db ./db
COPY scripts ./scripts

# Never root.
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
