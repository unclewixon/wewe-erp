# WEWE ERP API
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-workspace.yaml* ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter api --frozen-lockfile=false
COPY apps/api apps/api
RUN cd apps/api && npx tsc -p tsconfig.json

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
