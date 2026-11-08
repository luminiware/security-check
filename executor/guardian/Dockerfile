ARG BASE_IMAGE=node@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
FROM ${BASE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends nftables && rm -rf /var/lib/apt/lists/*
WORKDIR /guardian
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY executor/guardian/ ./executor/guardian/
COPY executor/address-policy.mjs ./executor/address-policy.mjs
ENTRYPOINT ["node", "executor/guardian/main.mjs"]
