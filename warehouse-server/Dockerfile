# Node 22 умеет исполнять TypeScript напрямую, поэтому шага сборки нет —
# нечему разъехаться между тем, что протестировано, и тем, что запущено.
FROM node:22-alpine

WORKDIR /app

# Зависимости ставятся отдельным слоем: пересобирается только при изменении
# package-lock.json, а не при каждой правке кода.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Контейнер не должен работать под root.
USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Проверка живости: оркестратор перезапустит контейнер, если база отвалилась.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--experimental-strip-types", "src/index.ts"]
