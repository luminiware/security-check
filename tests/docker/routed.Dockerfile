ARG GUARDIAN_IMAGE
FROM ${GUARDIAN_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends iproute2 && rm -rf /var/lib/apt/lists/*
COPY tests/docker/routed-entry.mjs /guardian/routed-entry.mjs
ENTRYPOINT ["node", "/guardian/routed-entry.mjs"]
