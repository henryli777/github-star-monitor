FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4320 DATA_DIR=/app/data

COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node public/ ./public/

RUN mkdir -p /app/data && chown node:node /app/data
USER 1000:1000
EXPOSE 4320
CMD ["node", "server.mjs"]
