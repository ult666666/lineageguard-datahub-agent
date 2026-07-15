FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173

COPY --chown=node:node package.json ./
COPY --chown=node:node api ./api
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node data ./data
COPY --chown=node:node examples ./examples
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node skills ./skills
COPY --chown=node:node test ./test

USER node

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4173/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "src/server.mjs"]
