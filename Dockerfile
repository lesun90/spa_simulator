FROM node:22-bookworm-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci

EXPOSE 5173

CMD ["sh", "scripts/docker-dev.sh"]
