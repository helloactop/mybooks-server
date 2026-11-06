FROM node:24-bookworm-slim AS admin-build
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev --include=optional --ignore-scripts --fetch-retries=4
COPY web-react/ ./web-react/
RUN npm run build:admin

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir /data && chown node:node /data
COPY --chown=node:node . .
COPY --from=admin-build --chown=node:node /app/web-react/dist ./web-react/dist
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MYBOOKS_STORAGE_DIR=/data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
