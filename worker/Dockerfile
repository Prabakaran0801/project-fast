FROM node:20-slim
RUN apt-get update && apt-get install -y python3 pipx && pipx install yt-dlp && ln -s /root/.local/bin/yt-dlp /usr/local/bin/yt-dlp
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "--loader", "tsx", "worker/src/index.ts"]
