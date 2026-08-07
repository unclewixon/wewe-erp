# WEWE ERP API — self-initialising image (migrates + seeds on first boot, then serves)
# Built with plain npm (apps/api has no workspace/link deps) — avoids corepack's
# pnpm-download step, which failed with UND_ERR_SOCKET on the cloud build.
FROM node:22-slim AS build
WORKDIR /repo/apps/api
COPY apps/api/package.json ./
RUN for i in 1 2 3 4 5; do \
      npm install --no-audit --no-fund --fetch-retries=6 --fetch-retry-maxtimeout=120000 --fetch-timeout=120000 --maxsockets=3 && break; \
      echo "npm install attempt $i failed, retrying in 10s..."; sleep 10; \
    done
COPY apps/api ./
RUN npx tsc -p tsconfig.json

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# DMS-04 OCR engine + PDF rasteriser
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr poppler-utils && rm -rf /var/lib/apt/lists/*
# full toolchain kept (node_modules incl. devDeps) so the entrypoint can run
# migrations (drizzle-kit) + seed (ts-node); npm installs into apps/api/node_modules
COPY --from=build /repo/apps/api ./apps/api
WORKDIR /app/apps/api
EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
