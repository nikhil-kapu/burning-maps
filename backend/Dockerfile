FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace backend --include-workspace-root=false
COPY backend/tsconfig*.json ./backend/
COPY backend/src ./backend/src
COPY backend/sql ./backend/sql
WORKDIR /app/backend
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN useradd --system --uid 10001 turtle
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
RUN npm ci --omit=dev --workspace backend --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/sql ./backend/sql
WORKDIR /app/backend
USER turtle
EXPOSE 8080
CMD ["node", "dist/server.js"]
