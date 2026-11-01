# Production image for the BookLeaf API (Render / Railway / any container host).
# Needs MONGODB_URI and JWT_SECRET at runtime; GEMINI_API_KEY is optional (degraded mode without it).

# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# The seed script reads the sample dataset (npm run db:seed:prod).
COPY data ./data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://localhost:${PORT:-4000}/api/v1/health || exit 1
CMD ["node", "dist/server.js"]
