FROM node:22

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    CONTEXT_PATH=/ \
    CACHE_ENABLED=true \
    CACHE_DIR=/app/cache \
    TEMP_DIR=/app/temp \
    CACHE_TTL=86400000 \
    MAX_REQUEST_SIZE=10mb \
    DEFAULT_THEME=default \
    DEFAULT_BACKGROUND=white \
    DEFAULT_WIDTH=800 \
    DEFAULT_HEIGHT=600 \
    BROWSER_TIMEOUT=30000 \
    ENABLE_BROWSER_CACHE=true \
    BROWSER_IDLE_MAX_MS=300000 \
    BROWSER_HEADLESS_MODE=new

# Install dependencies needed by Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-noto-cjk \
    wget \
    gnupg \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libnss3 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxshmfence1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libgtk-3-0 && \
    rm -rf /var/lib/apt/lists/*

# Pre-install Chrome via Puppeteer before real dependencies (simplifies debugging)
RUN npm init -y >/dev/null 2>&1 && \
    npm install --no-audit --no-fund puppeteer@23.11.1 && \
    npx puppeteer browsers install chrome && \
    rm -rf node_modules package.json package-lock.json

# Copy package manifests and install (include dev deps for easier debug)
COPY package*.json ./
RUN npm install

# Copy rest of source
COPY . .

RUN mkdir -p cache temp

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT||8080) + process.env.CONTEXT_PATH.replace(/\/$/,'') + '/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
