# The Hekaton hub: one small Node process, no build step.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY hub.js ./
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8600 HUB_DATA=/data NODE_ENV=production
EXPOSE 8600
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8600/healthz || exit 1
CMD ["node", "hub.js"]
