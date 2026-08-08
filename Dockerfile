FROM node:20-slim

# better-sqlite3 butuh build tools kalau prebuild gagal
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# TAS CLI global
RUN npm install -g @nightowne/tas-cli@2.4.1

# Patch: anonimkan caption chunk di chat bot (nama asli tidak bocor ke Telegram)
COPY patch-caption.js .
RUN node patch-caption.js && rm patch-caption.js

# Patch: chunk 49MB -> 18MB (Bot API getFile limit 20MB utk download)
COPY patch-chunks.js .
RUN node patch-chunks.js && rm patch-chunks.js

WORKDIR /app
COPY package.json .
RUN npm install --omit=dev

COPY server.js .
COPY public/ ./public/
RUN mkdir -p /data

ENV TAS_DATA_DIR=/data
ENV PORT=8001
EXPOSE 8001

CMD ["node", "server.js"]
