FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --frozen-lockfile --omit=dev

COPY index.js ./

# Run as non-root
RUN addgroup -S auralog && adduser -S auralog -G auralog
USER auralog

EXPOSE 3851

CMD ["node", "index.js"]
