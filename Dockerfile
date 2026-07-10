# Optional container build. The primary deploy on ronserver2 is PM2 + nginx
# (see DEPLOY.md); this is the alternate path.
FROM node:20-alpine AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN npm --prefix server install --omit=dev
COPY server/ ./server/
# Bring the built SPA into the location app.js serves from (../../web/dist).
COPY --from=web /app/web/dist ./web/dist
ENV NODE_ENV=production
EXPOSE 4400
CMD ["node", "server/src/app.js"]
