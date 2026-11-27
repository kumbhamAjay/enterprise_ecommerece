# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
# The API address is NOT needed at build time: src/proxy.ts reads API_URL when each request arrives.
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# `output: "standalone"` traces only the files the server needs: a much smaller image than copying node_modules.
FROM node:22-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=5001 HOSTNAME=0.0.0.0 API_URL=http://api:5000
WORKDIR /app
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 5001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5001/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
