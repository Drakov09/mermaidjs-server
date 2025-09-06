const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
// Removed child_process usage (no CLI invocations now)
const app = express();
const http = require('http');
const server = http.createServer(app);
const { WebSocketServer } = require('ws');
const WS_DEBUG_VERBOSE = process.env.WS_DEBUG_VERBOSE === 'true';

// Environment configuration
const PORT = process.env.PORT || 8080;
const CONTEXT_PATH = process.env.CONTEXT_PATH || '/';
const CACHE_ENABLED = process.env.CACHE_ENABLED !== 'false';
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const TEMP_DIR = process.env.TEMP_DIR || path.join(__dirname, 'temp');
const MAX_REQUEST_SIZE = process.env.MAX_REQUEST_SIZE || '10mb';
const DEFAULT_THEME = process.env.DEFAULT_THEME || 'default';
const DEFAULT_BACKGROUND = process.env.DEFAULT_BACKGROUND || 'white';
const DEFAULT_WIDTH = parseInt(process.env.DEFAULT_WIDTH) || 800;
const DEFAULT_HEIGHT = parseInt(process.env.DEFAULT_HEIGHT) || 600;
const BROWSER_TIMEOUT = parseInt(process.env.BROWSER_TIMEOUT) || 30000;
const ENABLE_BROWSER_CACHE = process.env.ENABLE_BROWSER_CACHE !== 'false';
const BROWSER_IDLE_MAX_MS = parseInt(process.env.BROWSER_IDLE_MAX_MS || '300000'); // idle shutdown (5m default)
const BROWSER_HEADLESS_MODE = process.env.BROWSER_HEADLESS_MODE || 'new';
// WebSocket idle / heartbeat configuration
const WS_IDLE_CLOSE_MS = parseInt(process.env.WS_IDLE_CLOSE_MS || '120000'); // default 120s (2x client 60s)
const WS_PING_INTERVAL_MS = parseInt(process.env.WS_PING_INTERVAL_MS || '30000');
// Eager dual-format generation removed per requirement
const sharp = require('sharp'); // for SVG -> PNG rasterization without browser

// Helper function to get route with context path (moved early to avoid ReferenceError on early use)
const getRoute = (route) => {
  const contextPath = CONTEXT_PATH.endsWith('/') ? CONTEXT_PATH.slice(0, -1) : CONTEXT_PATH;
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return contextPath === '/' || contextPath === '' ? normalizedRoute : `${contextPath}${normalizedRoute}`;
};

// Browser instance cache (lazy loading)
let browserInstance = null;
let browserInitializing = false;
let lastBrowserUseTs = 0;
let lastBrowserStartupDurationMs = 0;
let lastBrowserWasNew = false;

// Middleware
app.use(cors());
app.use(express.json({ limit: MAX_REQUEST_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_REQUEST_SIZE }));

// Create directories if they don't exist
fs.ensureDirSync(TEMP_DIR);
fs.ensureDirSync(CACHE_DIR);

// Static demo assets (served under optional CONTEXT_PATH)
app.use(getRoute('/demo'), express.static(path.join(__dirname, 'public')));

// Helper function to generate cache key
const generateCacheKey = (mermaidCode, options = {}) => {
  const normalizedOptions = {
    theme: options.theme || DEFAULT_THEME,
    backgroundColor: options.backgroundColor || DEFAULT_BACKGROUND,
    width: options.width || null,
    height: options.height || null
  };
  
  const content = mermaidCode + JSON.stringify(normalizedOptions);
  return crypto.createHash('sha256').update(content).digest('hex');
};

// Helper function to get cache file paths
const getCacheFilePaths = (cacheKey) => ({
  svg: path.join(CACHE_DIR, `${cacheKey}.svg`),
  png: path.join(CACHE_DIR, `${cacheKey}.png`),
  meta: path.join(CACHE_DIR, `${cacheKey}.meta.json`)
});

// Helper function to check if cache is valid
const isCacheValid = async (metaPath) => {
  try {
    const meta = await fs.readJson(metaPath);
    const now = Date.now();
    return (now - meta.timestamp) < CACHE_TTL;
  } catch (error) {
    return false;
  }
};

// Helper function to save to cache
const saveToCache = async (cacheKey, format, filePath, options = {}) => {
  if (!CACHE_ENABLED) return;
  
  try {
    const cachePaths = getCacheFilePaths(cacheKey);
    const targetPath = format === 'svg' ? cachePaths.svg : cachePaths.png;
    
    // Copy file to cache
    await fs.copy(filePath, targetPath);
    
    // Save metadata
    const meta = {
      timestamp: Date.now(),
      format,
      options,
      cacheKey
    };
    await fs.writeJson(cachePaths.meta, meta);
    
    console.log(`Cached ${format} for key: ${cacheKey}`);
  } catch (error) {
    console.warn('Failed to save to cache:', error.message);
  }
};

// Helper function to get from cache
const getFromCache = async (cacheKey, format) => {
  if (!CACHE_ENABLED) return null;
  
  try {
    const cachePaths = getCacheFilePaths(cacheKey);
    const targetPath = format === 'svg' ? cachePaths.svg : cachePaths.png;
    
    // Check if meta file exists and is valid
    if (!(await isCacheValid(cachePaths.meta))) {
      return null;
    }
    
    // Check if target file exists
    if (!(await fs.pathExists(targetPath))) {
      return null;
    }
    
    console.log(`Cache hit for ${format}, key: ${cacheKey}`);
    return targetPath;
  } catch (error) {
    console.warn('Failed to get from cache:', error.message);
    return null;
  }
};

// Browser instance management (lazy loading)
const getBrowserInstance = async () => {
  if (browserInstance) {
    lastBrowserWasNew = false;
    return browserInstance;
  }
  if (browserInitializing) {
    while (browserInitializing) {
      await new Promise(r => setTimeout(r, 100));
    }
    lastBrowserWasNew = false;
    return browserInstance;
  }
  try {
    browserInitializing = true;
    console.log('Initializing browser instance...');
    const start = Number(process.hrtime.bigint() / 1000000n);
    const puppeteer = require('puppeteer');
    browserInstance = await puppeteer.launch({
      headless: BROWSER_HEADLESS_MODE,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      timeout: BROWSER_TIMEOUT
    });
    lastBrowserStartupDurationMs = Number(process.hrtime.bigint() / 1000000n) - start;
    lastBrowserUseTs = Date.now();
    lastBrowserWasNew = true;
    console.log(`Browser instance initialized successfully in ${lastBrowserStartupDurationMs}ms`);
    browserInstance.on('disconnected', () => {
      console.log('Browser disconnected, clearing instance');
      browserInstance = null;
    });
    return browserInstance;
  } catch (error) {
    console.error('Failed to initialize browser:', error.message);
    browserInstance = null;
    throw error;
  } finally {
    browserInitializing = false;
  }
};

// Helper function to cleanup browser
const cleanupBrowser = async (reason = 'manual') => {
  if (browserInstance) {
    try {
      await browserInstance.close();
      console.log(`Browser instance closed (${reason})`);
    } catch (error) {
      console.warn('Error closing browser:', error.message);
    }
    browserInstance = null;
  }
};

// (Removed legacy SVG->PNG intermediate conversion helper; direct PNG rendering via renderMermaid API)

// Helper function to clean up temporary files
const cleanupFiles = async (files) => {
  for (const file of files) {
    try {
      await fs.remove(file);
    } catch (error) {
      console.warn(`Failed to cleanup file ${file}:`, error.message);
    }
  }
};

// High-resolution time helper
const hrNow = () => Number(process.hrtime.bigint() / 1000000n); // ms

// Programmatic rendering using @mermaid-js/mermaid-cli ESM exports
let mermaidCliModulePromise = null;
async function getMermaidCli() {
  if (!mermaidCliModulePromise) {
    mermaidCliModulePromise = import('@mermaid-js/mermaid-cli');
  }
  return mermaidCliModulePromise;
}

// Render with shared browser (produces SVG or PNG directly when needed)
async function renderWithMermaid(definition, format, { theme, backgroundColor, width, height }) {
  // Acquire browser (even SVG path needs it since library renders via puppeteer)
  const browser = await getBrowserInstance();
  const { renderMermaid } = await getMermaidCli();
  // Build mermaid config
  const mermaidConfig = { theme: theme || DEFAULT_THEME, securityLevel: 'strict' };
  const viewport = { width: width || DEFAULT_WIDTH, height: height || DEFAULT_HEIGHT, deviceScaleFactor: 1 };
  const { data } = await renderMermaid(browser, definition, format, { viewport, backgroundColor: backgroundColor || DEFAULT_BACKGROUND, mermaidConfig });
  lastBrowserUseTs = Date.now();
  return Buffer.from(data);
}

// Helper function to convert mermaid to output format WITH metadata
// Returns { outputPath, cacheKey, cacheStatus, source, timings }
const convertMermaid = async (mermaidCode, format, options = {}) => {
  const startTotal = hrNow();
  const { 
    theme = DEFAULT_THEME, 
    backgroundColor = DEFAULT_BACKGROUND, 
    width = DEFAULT_WIDTH, 
    height = DEFAULT_HEIGHT 
  } = options;

  const cacheKey = generateCacheKey(mermaidCode, { theme, backgroundColor, width, height });
  const timings = { cacheLookupMs: 0, renderMs: 0, rasterizeMs: 0 };
  let cacheStatus = 'MISS';
  let source = 'api';

  const cacheLookupStart = hrNow();
  // Try exact format from cache
  const cachedPath = await getFromCache(cacheKey, format);
  timings.cacheLookupMs = hrNow() - cacheLookupStart;
  if (cachedPath) {
    cacheStatus = 'HIT';
    source = 'cache';
    timings.totalMs = hrNow() - startTotal;
    return { outputPath: cachedPath, cacheKey, cacheStatus, source, timings, options: { theme, backgroundColor, width, height } };
  }

  if (format === 'png') {
    // First: attempt to rasterize from cached SVG (no extra mermaid render)
    const cachedSvgPath = await getFromCache(cacheKey, 'svg');
    if (cachedSvgPath) {
      cacheStatus = 'HIT-SVG';
      source = 'cache-svg-rasterized';
      const rasterStart = hrNow();
      const svgContent = await fs.readFile(cachedSvgPath);
      const pngBuffer = await sharp(svgContent).png().toBuffer();
      timings.rasterizeMs = hrNow() - rasterStart;
      const tmpId = uuidv4();
      const tmpPngPath = path.join(TEMP_DIR, `${tmpId}.png`);
      await fs.writeFile(tmpPngPath, pngBuffer);
      await saveToCache(cacheKey, 'png', tmpPngPath, { theme, backgroundColor, width, height });
      timings.totalMs = hrNow() - startTotal;
      return { outputPath: getCacheFilePaths(cacheKey).png, cacheKey, cacheStatus, source, timings, options: { theme, backgroundColor, width, height } };
    }
    // No SVG cache: render PNG directly via mermaid (browser once)
    const outputId = uuidv4();
    const outputPath = path.join(TEMP_DIR, `${outputId}.png`);
    try {
      const renderStart = hrNow();
      const pngBuffer = await renderWithMermaid(mermaidCode, 'png', { theme, backgroundColor, width, height });
      timings.renderMs = hrNow() - renderStart;
      await fs.writeFile(outputPath, pngBuffer);
      await saveToCache(cacheKey, 'png', outputPath, { theme, backgroundColor, width, height });
      timings.totalMs = hrNow() - startTotal;
      return { outputPath, cacheKey, cacheStatus, source, timings, options: { theme, backgroundColor, width, height } };
    } catch (error) {
      console.error('mermaid-cli API PNG render error:', error.message);
      throw new Error(`Failed to convert mermaid to PNG: ${error.message}`);
    } finally {
      if (!timings.totalMs) timings.totalMs = hrNow() - startTotal;
    }
  }

  // format === 'svg'
  const outputId = uuidv4();
  const outputPath = path.join(TEMP_DIR, `${outputId}.svg`);
  try {
    const renderStart = hrNow();
    const renderResult = await renderWithMermaid(mermaidCode, 'svg', { theme, backgroundColor, width, height });
    timings.renderMs = hrNow() - renderStart;
    await fs.writeFile(outputPath, renderResult);
    await saveToCache(cacheKey, 'svg', outputPath, { theme, backgroundColor, width, height });
    timings.totalMs = hrNow() - startTotal;
    return { outputPath, cacheKey, cacheStatus, source, timings, options: { theme, backgroundColor, width, height } };
  } catch (error) {
    console.error('mermaid-cli API error:', error.message);
    throw new Error(`Failed to convert mermaid: ${error.message}`);
  } finally {
    if (!timings.totalMs) timings.totalMs = hrNow() - startTotal;
  }
};

// (getRoute defined earlier)

// Health check endpoint
app.get(getRoute('/health'), (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    config: {
      contextPath: CONTEXT_PATH,
      cache: {
        enabled: CACHE_ENABLED,
        directory: CACHE_DIR,
        ttl: CACHE_TTL
      },
      browser: {
        cached: !!browserInstance,
        timeout: BROWSER_TIMEOUT
      },
      defaults: {
        theme: DEFAULT_THEME,
        background: DEFAULT_BACKGROUND,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT
      }
    }
  });
});

// API documentation endpoint
app.get(getRoute('/'), (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}${CONTEXT_PATH === '/' ? '' : CONTEXT_PATH}`;
  
  res.json({
    name: 'Mermaid Conversion Server',
    version: '2.0.0',
    contextPath: CONTEXT_PATH,
    features: [
      'File system caching with configurable TTL',
      'Lazy browser instance loading',
      'SVG to PNG conversion optimization',
      'Base64 encoded mermaid code in GET requests',
      'Environment variable configuration',
      'Browser instance reuse and caching'
    ],
    endpoints: {
      [`GET ${getRoute('/health')}`]: 'Health check endpoint with cache status',
      [`GET ${getRoute('/svg')}`]: 'Convert to SVG via GET (query: mmd, theme, bg, w, h)',
      [`GET ${getRoute('/png')}`]: 'Convert to PNG via GET (query: mmd, theme, bg, w, h)',
      [`POST ${getRoute('/convert/svg')}`]: 'Convert mermaid diagram to SVG',
      [`POST ${getRoute('/convert/png')}`]: 'Convert mermaid diagram to PNG (binary or base64)',
      [`GET ${getRoute('/cache/stats')}`]: 'Get cache statistics',
      [`DELETE ${getRoute('/cache')}`]: 'Clear cache'
    },
    parameters: {
      mmd: 'Base64 encoded mermaid diagram code (for GET requests)',
      theme: `default|dark|forest|neutral (default: ${DEFAULT_THEME})`,
      bg: `white|transparent|#hexcolor (default: ${DEFAULT_BACKGROUND})`,
      w: `width in pixels (default: ${DEFAULT_WIDTH})`,
      h: `height in pixels (default: ${DEFAULT_HEIGHT})`,
      format: 'binary|base64 (for PNG POST requests only)'
    },
    cache: {
      enabled: CACHE_ENABLED,
      ttl_hours: CACHE_TTL / (60 * 60 * 1000),
      directory: CACHE_DIR
    },
    environment_variables: {
      PORT: `Server port (current: ${PORT})`,
      CONTEXT_PATH: `Base path for all routes (current: ${CONTEXT_PATH})`,
      CACHE_ENABLED: `Enable/disable caching (current: ${CACHE_ENABLED})`,
      CACHE_DIR: `Directory for cache files (current: ${CACHE_DIR})`,
      CACHE_TTL: `Cache TTL in milliseconds (current: ${CACHE_TTL})`,
      TEMP_DIR: `Temporary files directory (current: ${TEMP_DIR})`,
      MAX_REQUEST_SIZE: `Maximum request body size (current: ${MAX_REQUEST_SIZE})`,
      DEFAULT_THEME: `Default theme (current: ${DEFAULT_THEME})`,
      DEFAULT_BACKGROUND: `Default background (current: ${DEFAULT_BACKGROUND})`,
      DEFAULT_WIDTH: `Default width (current: ${DEFAULT_WIDTH})`,
      DEFAULT_HEIGHT: `Default height (current: ${DEFAULT_HEIGHT})`,
      BROWSER_TIMEOUT: `Browser timeout in ms (current: ${BROWSER_TIMEOUT})`,
      ENABLE_BROWSER_CACHE: `Enable browser instance caching (current: ${ENABLE_BROWSER_CACHE})`
    },
    examples: {
      'GET SVG': `${baseUrl}${getRoute('/svg')}?mmd=` + Buffer.from('graph TD\\n    A[Start] --> B[End]').toString('base64') + '&theme=dark',
      'GET PNG': `${baseUrl}${getRoute('/png')}?mmd=` + Buffer.from('graph TD\\n    A[Start] --> B[End]').toString('base64') + '&bg=transparent',
      'POST Body': {
        mermaid: 'graph TD\\n    A[Client] --> B[Server]',
        theme: DEFAULT_THEME,
        backgroundColor: DEFAULT_BACKGROUND
      }
    },
    response_headers: {
      'X-Mermaid-Cache': 'HIT | HIT-SVG | MISS',
      'X-Mermaid-Cache-Key': 'SHA256 hash of diagram + options',
  'X-Mermaid-Source': 'cache | cache-svg-rasterized | api',
  'X-Mermaid-Render-Time-ms': 'Programmatic render time (renderMermaid)',
      'X-Mermaid-Rasterize-Time-ms': 'SVG->PNG conversion time',
      'X-Mermaid-Cache-Lookup-ms': 'Cache lookup time',
      'X-Mermaid-Total-Time-ms': 'End-to-end total time',
      'X-Mermaid-Params': 'Normalized parameters JSON',
      'X-Mermaid-Browser-Startup-Time-ms': 'Browser launch time (if newly launched)',
      'X-Mermaid-Browser-Reused': 'true if reused existing instance',
  'X-Mermaid-Browser-Fallback': 'Reserved (no CLI fallback; always API)'
    }
  });
});

// GET endpoint for SVG conversion
app.get(getRoute('/svg'), async (req, res) => {
  const { mmd, theme, bg: backgroundColor, w: width, h: height } = req.query;
  
  if (!mmd) {
    return res.status(400).json({ error: 'mmd parameter (base64 encoded mermaid code) is required' });
  }
  
  try {
    // Decode base64 mermaid code
    const mermaidCode = Buffer.from(mmd, 'base64').toString('utf8');
    
    // Convert to SVG
  const result = await convertMermaid(mermaidCode, 'svg', {
      theme,
      backgroundColor,
      width: width ? parseInt(width) : undefined,
      height: height ? parseInt(height) : undefined
    });
  const { outputPath, cacheKey, cacheStatus, source, timings, options, browserStartupMs, browserReused, browserFallback } = result;
  const svgContent = await fs.readFile(outputPath, 'utf8');
  // Set diagnostic headers
  res.setHeader('X-Mermaid-Cache', cacheStatus);
  res.setHeader('X-Mermaid-Cache-Key', cacheKey);
  res.setHeader('X-Mermaid-Source', source);
  res.setHeader('X-Mermaid-Render-Time-ms', timings.renderMs ?? 0);
  res.setHeader('X-Mermaid-Cache-Lookup-ms', timings.cacheLookupMs ?? 0);
  if (timings.rasterizeMs) res.setHeader('X-Mermaid-Rasterize-Time-ms', timings.rasterizeMs);
  res.setHeader('X-Mermaid-Total-Time-ms', timings.totalMs ?? 0);
  res.setHeader('X-Mermaid-Params', JSON.stringify(options));
  if (browserStartupMs !== undefined) res.setHeader('X-Mermaid-Browser-Startup-Time-ms', browserStartupMs || 0);
  if (browserReused !== undefined) res.setHeader('X-Mermaid-Browser-Reused', String(browserReused));
  if (browserFallback) res.setHeader('X-Mermaid-Browser-Fallback', browserFallback);
    res.setHeader('Content-Type', 'image/svg+xml');
    if (ENABLE_BROWSER_CACHE) {
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour browser cache
    }
    res.send(svgContent);
    
  } catch (error) {
    console.error('Error converting to SVG:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET endpoint for PNG conversion
app.get(getRoute('/png'), async (req, res) => {
  const { mmd, theme, bg: backgroundColor, w: width, h: height } = req.query;
  
  if (!mmd) {
    return res.status(400).json({ error: 'mmd parameter (base64 encoded mermaid code) is required' });
  }
  
  try {
    // Decode base64 mermaid code
    const mermaidCode = Buffer.from(mmd, 'base64').toString('utf8');
    
    // Convert to PNG
  const result = await convertMermaid(mermaidCode, 'png', {
      theme,
      backgroundColor,
      width: width ? parseInt(width) : undefined,
      height: height ? parseInt(height) : undefined
    });
  const { outputPath, cacheKey, cacheStatus, source, timings, options, browserStartupMs, browserReused, browserFallback } = result;
  const pngBuffer = await fs.readFile(outputPath);
  // Set diagnostic headers
  res.setHeader('X-Mermaid-Cache', cacheStatus);
  res.setHeader('X-Mermaid-Cache-Key', cacheKey);
  res.setHeader('X-Mermaid-Source', source);
  res.setHeader('X-Mermaid-Render-Time-ms', timings.renderMs ?? 0);
  res.setHeader('X-Mermaid-Cache-Lookup-ms', timings.cacheLookupMs ?? 0);
  if (timings.rasterizeMs) res.setHeader('X-Mermaid-Rasterize-Time-ms', timings.rasterizeMs);
  res.setHeader('X-Mermaid-Total-Time-ms', timings.totalMs ?? 0);
  res.setHeader('X-Mermaid-Params', JSON.stringify(options));
  if (browserStartupMs !== undefined) res.setHeader('X-Mermaid-Browser-Startup-Time-ms', browserStartupMs || 0);
  if (browserReused !== undefined) res.setHeader('X-Mermaid-Browser-Reused', String(browserReused));
  if (browserFallback) res.setHeader('X-Mermaid-Browser-Fallback', browserFallback);
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', pngBuffer.length);
    if (ENABLE_BROWSER_CACHE) {
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour browser cache
    }
    res.send(pngBuffer);
    
  } catch (error) {
    console.error('Error converting to PNG:', error);
    res.status(500).json({ error: error.message });
  }
});

// Convert mermaid text to SVG (POST)
app.post(getRoute('/convert/svg'), async (req, res) => {
  const { mermaid, theme, backgroundColor, width, height } = req.body;
  
  if (!mermaid) {
    return res.status(400).json({ error: 'Mermaid diagram text is required' });
  }
  
  try {
    // Convert to SVG
  const result = await convertMermaid(mermaid, 'svg', {
      theme,
      backgroundColor,
      width,
      height
    });
  const { outputPath, cacheKey, cacheStatus, source, timings, options, browserStartupMs, browserReused, browserFallback } = result;
  const svgContent = await fs.readFile(outputPath, 'utf8');
  res.setHeader('X-Mermaid-Cache', cacheStatus);
  res.setHeader('X-Mermaid-Cache-Key', cacheKey);
  res.setHeader('X-Mermaid-Source', source);
  res.setHeader('X-Mermaid-Render-Time-ms', timings.renderMs ?? 0);
  res.setHeader('X-Mermaid-Cache-Lookup-ms', timings.cacheLookupMs ?? 0);
  if (timings.rasterizeMs) res.setHeader('X-Mermaid-Rasterize-Time-ms', timings.rasterizeMs);
  res.setHeader('X-Mermaid-Total-Time-ms', timings.totalMs ?? 0);
  res.setHeader('X-Mermaid-Params', JSON.stringify(options));
  if (browserStartupMs !== undefined) res.setHeader('X-Mermaid-Browser-Startup-Time-ms', browserStartupMs || 0);
  if (browserReused !== undefined) res.setHeader('X-Mermaid-Browser-Reused', String(browserReused));
  if (browserFallback) res.setHeader('X-Mermaid-Browser-Fallback', browserFallback);
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svgContent);
    
  } catch (error) {
    console.error('Error converting to SVG:', error);
    res.status(500).json({ error: error.message });
  }
});

// Convert mermaid text to PNG (POST)
app.post(getRoute('/convert/png'), async (req, res) => {
  const { mermaid, theme, backgroundColor, width, height, format = 'binary' } = req.body;
  
  if (!mermaid) {
    return res.status(400).json({ error: 'Mermaid diagram text is required' });
  }
  
  try {
    // Convert to PNG
  const result = await convertMermaid(mermaid, 'png', {
      theme,
      backgroundColor,
      width,
      height
    });
  const { outputPath, cacheKey, cacheStatus, source, timings, options, browserStartupMs, browserReused, browserFallback } = result;
    
    if (format === 'base64') {
      // Return base64 encoded PNG in JSON
      const pngBuffer = await fs.readFile(outputPath);
      const base64Data = pngBuffer.toString('base64');
      
  res.setHeader('X-Mermaid-Cache', cacheStatus);
  res.setHeader('X-Mermaid-Cache-Key', cacheKey);
  res.setHeader('X-Mermaid-Source', source);
  res.setHeader('X-Mermaid-Render-Time-ms', timings.renderMs ?? 0);
  res.setHeader('X-Mermaid-Cache-Lookup-ms', timings.cacheLookupMs ?? 0);
  if (timings.rasterizeMs) res.setHeader('X-Mermaid-Rasterize-Time-ms', timings.rasterizeMs);
  res.setHeader('X-Mermaid-Total-Time-ms', timings.totalMs ?? 0);
  res.setHeader('X-Mermaid-Params', JSON.stringify(options));
  if (browserStartupMs !== undefined) res.setHeader('X-Mermaid-Browser-Startup-Time-ms', browserStartupMs || 0);
  if (browserReused !== undefined) res.setHeader('X-Mermaid-Browser-Reused', String(browserReused));
  if (browserFallback) res.setHeader('X-Mermaid-Browser-Fallback', browserFallback);
  res.json({
        success: true,
        format: 'png',
        encoding: 'base64',
        data: base64Data,
        size: pngBuffer.length
      });
    } else {
      // Return binary PNG
      const pngBuffer = await fs.readFile(outputPath);
  res.setHeader('X-Mermaid-Cache', cacheStatus);
  res.setHeader('X-Mermaid-Cache-Key', cacheKey);
  res.setHeader('X-Mermaid-Source', source);
  res.setHeader('X-Mermaid-Render-Time-ms', timings.renderMs ?? 0);
  res.setHeader('X-Mermaid-Cache-Lookup-ms', timings.cacheLookupMs ?? 0);
  if (timings.rasterizeMs) res.setHeader('X-Mermaid-Rasterize-Time-ms', timings.rasterizeMs);
  res.setHeader('X-Mermaid-Total-Time-ms', timings.totalMs ?? 0);
  res.setHeader('X-Mermaid-Params', JSON.stringify(options));
  if (browserStartupMs !== undefined) res.setHeader('X-Mermaid-Browser-Startup-Time-ms', browserStartupMs || 0);
  if (browserReused !== undefined) res.setHeader('X-Mermaid-Browser-Reused', String(browserReused));
  if (browserFallback) res.setHeader('X-Mermaid-Browser-Fallback', browserFallback);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', pngBuffer.length);
      res.send(pngBuffer);
    }
    
  } catch (error) {
    console.error('Error converting to PNG:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cache management endpoints
app.get(getRoute('/cache/stats'), async (req, res) => {
  if (!CACHE_ENABLED) {
    return res.json({ enabled: false });
  }
  
  try {
    const files = await fs.readdir(CACHE_DIR);
    const svgFiles = files.filter(f => f.endsWith('.svg')).length;
    const pngFiles = files.filter(f => f.endsWith('.png')).length;
    const metaFiles = files.filter(f => f.endsWith('.meta.json')).length;
    
    res.json({
      enabled: true,
      directory: CACHE_DIR,
      ttl: CACHE_TTL,
      files: {
        svg: svgFiles,
        png: pngFiles,
        meta: metaFiles,
        total: files.length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete(getRoute('/cache'), async (req, res) => {
  if (!CACHE_ENABLED) {
    return res.json({ enabled: false });
  }
  
  try {
    await fs.emptyDir(CACHE_DIR);
    res.json({ success: true, message: 'Cache cleared' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a specific cache entry by cacheKey
app.delete(getRoute('/cache/:key'), async (req, res) => {
  if (!CACHE_ENABLED) return res.status(400).json({ error: 'Cache disabled' });
  const { key } = req.params;
  if (!/^[a-f0-9]{64}$/.test(key)) return res.status(400).json({ error: 'Invalid cache key format' });
  try {
    const { svg, png, meta } = getCacheFilePaths(key);
    let removed = [];
    for (const f of [svg, png, meta]) {
      if (await fs.pathExists(f)) { await fs.remove(f); removed.push(path.basename(f)); }
    }
    if (removed.length === 0) return res.status(404).json({ error: 'Cache entry not found' });
    res.json({ success: true, removed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`${signal} received, shutting down gracefully`);
  
  // Close browser instance
  await cleanupBrowser('graceful-shutdown');
  
  // Do NOT clear cache directory to keep persistent cache; only temp cleaned optionally
  try { await fs.emptyDir(TEMP_DIR); } catch (_) {}
  
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Also handle PM2 graceful reload
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

server.listen(PORT, () => {
  console.log(`🚀 Mermaid conversion server (with WS) running on port ${PORT}`);
  console.log(`📍 Context path: ${CONTEXT_PATH}`);
  console.log(`🏥 Health check: http://localhost:${PORT}${getRoute('/health')}`);
  console.log(`📚 API documentation: http://localhost:${PORT}${getRoute('/')}`);
  console.log(`💾 Cache enabled: ${CACHE_ENABLED}`);
  console.log(`📁 Cache directory: ${CACHE_DIR}`);
  console.log(`⏰ Cache TTL: ${CACHE_TTL}ms`);
  console.log(`🌐 Browser cache enabled: ${ENABLE_BROWSER_CACHE}`);
  console.log(`🛑 Browser idle max (ms): ${BROWSER_IDLE_MAX_MS}`);
  console.log(`⚙️  Environment configuration loaded successfully`);
  console.log(`🧪 Demo page: http://localhost:${PORT}${getRoute('/demo')}/index.html`);
});

module.exports = { app, server };

// WebSocket server for live demo
const wss = new WebSocketServer({ server, path: getRoute('/ws') });

// Low-level upgrade logging
server.on('upgrade', (req, socket, head) => {
  if (WS_DEBUG_VERBOSE) {
    console.log(`[WS-UPGRADE] url=${req.url} ua=${req.headers['user-agent']||''}`);
  }
});

server.on('clientError', (err, socket) => {
  if (WS_DEBUG_VERBOSE) {
    console.warn('[WS-CLIENT-ERROR]', err.message);
  }
  try { socket.destroy(); } catch(_){}
});

process.on('unhandledRejection', (reason, p) => {
  console.error('[UNHANDLED_REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT_EXCEPTION]', err);
});

function safeJson(ws, obj){
  try { ws.send(JSON.stringify(obj)); } catch(_) {}
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.lastActivity = Date.now();
  ws._id = Math.random().toString(36).slice(2,10);
  console.log(`[WS] connection open id=${ws._id} total=${wss.clients.size}`);
  ws.on('pong', () => { ws.isAlive = true; ws.lastActivity = Date.now(); });
  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== 'render') return;
    const { mermaid: mermaidCode, theme, backgroundColor, width, height, format='png' } = msg;
    if (!mermaidCode || typeof mermaidCode !== 'string') {
      return safeJson(ws, { type: 'render-result', error: 'mermaid code missing' });
    }
    // Basic length guard
    if (mermaidCode.length > 20000) {
      return safeJson(ws, { type: 'render-result', error: 'diagram too large' });
    }
    ws.lastActivity = Date.now();
    try {
      const result = await convertMermaid(mermaidCode, format === 'svg' ? 'svg' : 'png', {
        theme, backgroundColor, width, height
      });
      const { outputPath, cacheKey, cacheStatus, timings } = result;
      if (format === 'png') {
        const buf = await fs.readFile(outputPath);
        safeJson(ws, { 
          type: 'render-result', 
          format: 'png', 
          pngBase64: buf.toString('base64'),
          cache: cacheStatus,
          cacheKey,
          timings: {
            render: timings.renderMs || 0,
            rasterize: timings.rasterizeMs || 0,
            total: timings.totalMs || 0
          },
          width, height
        });
      } else {
        const svg = await fs.readFile(outputPath, 'utf8');
        safeJson(ws, { 
          type: 'render-result', 
          format: 'svg', 
          svg,
          cache: cacheStatus,
          cacheKey,
          timings: {
            render: timings.renderMs || 0,
            total: timings.totalMs || 0
          },
          width, height
        });
      }
    } catch (e) {
      safeJson(ws, { type: 'render-result', error: e.message });
    }
  });
  ws.on('close', (code, reason) => {
    const idleFor = Date.now() - (ws.lastActivity || 0);
    console.log(`[WS] close id=${ws._id} code=${code} reason=${reason?.toString()||''} idleForMs=${idleFor} terminateReason=${ws._terminateReason||''} isAlive=${ws.isAlive}`);
  });
  ws.on('error', (err) => {
    console.error(`[WS] error id=${ws._id}:`, err.message);
  });
  if (WS_DEBUG_VERBOSE) {
    ws.on('unexpected-response', (req, res) => {
      console.warn(`[WS] unexpected-response id=${ws._id} status=${res.statusCode}`);
    });
  }
});

// Idle browser reaper
if (BROWSER_IDLE_MAX_MS > 0) {
  setInterval(() => {
    if (browserInstance && lastBrowserUseTs && (Date.now() - lastBrowserUseTs) > BROWSER_IDLE_MAX_MS) {
      cleanupBrowser('idle-timeout');
    }
  }, Math.min(60000, BROWSER_IDLE_MAX_MS));
}

// WebSocket heartbeat & idle close
if (WS_PING_INTERVAL_MS > 0) {
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.readyState !== 1) return;
      const idleFor = Date.now() - (ws.lastActivity || 0);
      if (idleFor > WS_IDLE_CLOSE_MS) {
  try { ws._terminateReason = `idle>${WS_IDLE_CLOSE_MS}`; ws.terminate(); console.log(`[WS] terminate id=${ws._id} reason=idle timeout idleForMs=${idleFor}`); } catch(_) {}
        return;
      }
      if (!ws.isAlive) {
  try { ws._terminateReason = 'pong-missing'; ws.terminate(); console.log(`[WS] terminate id=${ws._id} reason=pong-missing`); } catch(_) {}
        return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch(_) {}
    });
  }, WS_PING_INTERVAL_MS);
}
