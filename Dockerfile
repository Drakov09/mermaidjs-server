# Use the official Node.js image as the base image (latest LTS version)
FROM node:22 AS base

# Set the working directory
WORKDIR /app

# We don't need the standalone Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

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

# Install Google Chrome Stable and fonts
# Note: this installs the necessary libs to make the browser work with Puppeteer.
RUN apt-get update && apt-get install -y --no-install-recommends gnupg wget ca-certificates fonts-liberation && \
    wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \
    sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
    apt-get update && \
    apt-get install google-chrome-stable -y --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Verify that Chrome is installed at the expected location
RUN ls -alh /usr/bin/google-chrome-stable && \
    /usr/bin/google-chrome-stable --version

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
