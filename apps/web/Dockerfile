# WEWE ERP web — the VERBATIM design bundle with serve-time transforms baked at build
FROM node:22-slim AS build
WORKDIR /repo
COPY apps/web/package.json apps/web/
RUN cd apps/web && for i in 1 2 3 4 5; do \
      npm install --no-audit --no-fund --fetch-retries=6 --fetch-retry-maxtimeout=120000 --fetch-timeout=120000 --maxsockets=3 && break; \
      echo "npm install attempt $i failed, retrying in 10s..."; sleep 10; \
    done
COPY apps/web apps/web
COPY design design
COPY scripts/check-design-verbatim.sh scripts/
RUN bash scripts/check-design-verbatim.sh && cd apps/web && npx vite build \
 && cp support.js dist/support.js

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
