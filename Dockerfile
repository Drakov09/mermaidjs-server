# Use the official Node.js image as the base image (latest LTS version)
FROM node:22 AS base

# Set the working directory
WORKDIR /app

## Allow Puppeteer to download the correct Chromium for each architecture (amd64/arm64)
# (Don't set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD so multi-arch build works without system Chrome)

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

## Install shared libraries & fonts needed by headless Chromium (works for both amd64 & arm64)
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

# (Chromium binary will be downloaded during npm ci by Puppeteer)

FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p cache temp && chmod 777 cache temp

# Create a non-root user for security
RUN groupadd -r nodeuser && useradd -r -g nodeuser nodeuser && \
    chown -R nodeuser:nodeuser /app
USER nodeuser

# Expose the port on which your app will run
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT||8080) + process.env.CONTEXT_PATH.replace(/\/$/,'') + '/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Use node directly (avoid npm in CMD for faster startup)
CMD ["node", "server.js"]
