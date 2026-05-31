import { knownThirdPartyProxies } from './thirdPartyProxies.js';
import { streamPatterns } from './streamPatterns.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let serverPromise: Promise<any> | undefined;

async function initializeServer() {
  const { OMSSServer } = await import('@omss/framework');
  const instance = new OMSSServer({
    name: 'CinePro',
    version: '1.0.0',
    host: process.env.HOST ?? 'localhost',
    port: Number(process.env.PORT ?? 3000),
    publicUrl: process.env.PUBLIC_URL,
    cache: {
      type: (process.env.CACHE_TYPE as 'memory' | 'redis') ?? 'memory',
      ttl: {
        sources: 60 * 60,
        subtitles: 60 * 60 * 24
      },
      redis: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD
      }
    },
    tmdb: {
      apiKey: process.env.TMDB_API_KEY!,
      cacheTTL: 24 * 60 * 60
    },
    proxyConfig: {
      knownThirdPartyProxies: knownThirdPartyProxies,
      streamPatterns
    },
    cors: {
      origin: process.env.CORS_ORIGIN ?? '*',
      methods: ['GET', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['Content-Range', 'Accept-Ranges', 'ETag'],
      preflightContinue: false,
      optionsSuccessStatus: 204
    },
    stremio: {
      enableNativeAddon: process.env.STREMIO_ADDON === 'true',
      stremioAddons: [
        {
          id: 'notorrent2',
          url: 'https://addon.notorrent2.workers.dev/manifest.json',
          enabled: true
        }
      ]
    },
    mcp: {
      enabled: process.env.MCP_ENABLED === 'true'
    }
  });

  const registry = instance.getRegistry();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  await registry.discoverProviders(path.join(__dirname, './providers/'));
  
  return instance.getInstance();
}

export async function getServer() {
  if (!serverPromise) {
    serverPromise = initializeServer();
  }
  return serverPromise;
}

type WorkerExecutionContext = {
  waitUntil(promise: Promise<void>): void;
  passThroughOnException(): void;
  readonly clientId: string;
};

// Cloudflare Workers / Vercel Serverless Function handler
export default async function handler(
  request: Request,
  env: Record<string, string>,
  ctx: WorkerExecutionContext
): Promise<Response> {
  // Merge Vercel env with process.env
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
  }

  const s = await getServer();
  await s.ready();

  const url = new URL(request.url);
  const result = await s.inject({
    method: request.method as any,
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers.entries())
  });

  const responseHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.headers)) {
    if (value !== undefined && value !== null) {
      responseHeaders[key] = Array.isArray(value) ? value.join(', ') : String(value);
    }
  }

  return new Response(result.body, {
    status: result.statusCode,
    headers: responseHeaders
  });
}