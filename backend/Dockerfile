# syntax=docker/dockerfile:1
# Multi-stage: the final image holds only compiled JS + production dependencies (no compiler, no dev tools, no source).
# Layer order matters for the cache: package*.json changes rarely, so `npm ci` is re-run only when dependencies change.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY db ./db
USER node
EXPOSE 5000
# Ready = the database answers. (node's built-in fetch: no curl needed in the image)
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# exec form: node is PID 1 and receives SIGTERM directly, so graceful shutdown works
CMD ["node", "dist/server.js"]
