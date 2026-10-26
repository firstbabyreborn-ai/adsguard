# Multi-stage: no build step needed (zero deps), so the image is tiny and boots fast.
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
# Optional dep only (pg). --omit=dev keeps the image minimal.
RUN npm install --omit=dev --no-audit --no-fund || true

COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts

# Run as non-root
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

ENV PORT=3000 HOST=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
