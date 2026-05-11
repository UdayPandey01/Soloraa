FROM node:20-slim

WORKDIR /app

COPY solora_relayer/package.json solora_relayer/package-lock.json ./solora_relayer/
RUN cd solora_relayer && npm ci

COPY solora_relayer ./solora_relayer

CMD ["npx", "--prefix", "solora_relayer", "tsx", "solora_relayer/ops.ts", "demo-local"]
