# WEWE ERP web — the VERBATIM design bundle with serve-time transforms baked at build
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY apps/web/package.json apps/web/
RUN cd apps/web && npm install --no-audit --no-fund
COPY apps/web apps/web
COPY design design
COPY scripts/check-design-verbatim.sh scripts/
RUN bash scripts/check-design-verbatim.sh && cd apps/web && npx vite build

FROM nginx:alpine
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
