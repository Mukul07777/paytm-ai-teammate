FROM node:22-alpine
ENV NODE_ENV=production DOST_DB_FILE=/data/db.json
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY public ./public
COPY policies ./policies
RUN mkdir -p /data && chown -R node:node /data /app/policies
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
