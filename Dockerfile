FROM node:20-alpine

WORKDIR /app

# Nur package files zuerst kopieren für besseres Caching
COPY package*.json ./
RUN npm install --omit=dev

# Rest kopieren
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
