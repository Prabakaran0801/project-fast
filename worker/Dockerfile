# Worker — BullMQ + yt-dlp + ffmpeg (Fly.io / Railway / ECS)
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg ca-certificates curl \
  && pip install --break-system-packages yt-dlp --no-cache-dir \
  && yt-dlp --version \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate
COPY worker ./worker
COPY src ./src
COPY tsconfig.json ./

# Healthcheck: worker heartbeat file + redis ping
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1

ENV NODE_ENV=production
# yt-dlp binary explicitly
ENV YT_DLP_PATH=/usr/local/bin/yt-dlp
CMD ["node", "--loader", "tsx", "worker/src/index.ts"]
