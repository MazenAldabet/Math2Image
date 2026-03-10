FROM node:24-alpine3.21

WORKDIR /app

RUN printf '%s\n' \
  'https://dl-cdn.alpinelinux.org/alpine/v3.21/main' \
  'https://dl-cdn.alpinelinux.org/alpine/v3.21/community' \
  > /etc/apk/repositories \
  && apk update \
  && apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    font-freefont

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/output

CMD ["node", "test.js"]