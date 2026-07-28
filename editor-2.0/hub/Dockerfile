# IFC-Hub — Betriebsart b (zentral/Team).
#
# Dasselbe Artefakt wie im Standalone-Betrieb; nur Bind-Adresse, Datenpfad und
# Token kommen aus der Umgebung. Bewusst ohne Build-Schritt: der Hub läuft über
# tsx direkt aus den TypeScript-Quellen, und es gibt keine nativen Abhängigkeiten,
# die kompiliert werden müssten.
FROM node:22-slim

WORKDIR /app

# Abhängigkeiten zuerst — eigene Schicht, damit Codeänderungen den
# npm-Install-Cache nicht entwerten.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

# Datenverzeichnis als Volume: Katalog und Blobs überleben ein Image-Update.
ENV HUB_DATA_DIR=/data \
    HUB_HOST=0.0.0.0 \
    HUB_PORT=8711 \
    NODE_ENV=production
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
EXPOSE 8711

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HUB_PORT||8711)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npx", "tsx", "src/main.ts"]
