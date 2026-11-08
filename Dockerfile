FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /data /toolbox \
    && chown node:node /data /toolbox
COPY --chown=node:node . .
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MYBOOKS_STORAGE_DIR=/data \
    MYBOOKS_TOOLBOX_DIR=/toolbox
USER node
EXPOSE 3000
VOLUME ["/data", "/toolbox"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
