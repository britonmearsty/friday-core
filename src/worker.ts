import { knownThirdPartyProxies } from './thirdPartyProxies.js';
import { streamPatterns } from './streamPatterns.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

declare global {
  interface ExecutionContext {
    waitUntil(promise: Promise<void>): void;
    passThroughOnException(): void;
    readonly clientId: string;
  }
}

let serverPromise: Promise<any> | undefined;

async function initializeServer(env?: Record<string, string>) {
  // Merge env into process.env for OMSS framework compatibility
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      process.env[key] = value;
    }
  }

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

export async function getServer(env?: Record<string, string>) {
  if (!serverPromise) {
    serverPromise = initializeServer(env);
  }
  return serverPromise;
}

// Vercel Serverless Function handler (Node.js format)
export default async function handler(
  request: http.IncomingMessage,
  reply: http.ServerResponse
): Promise<void> {
  const s = await getServer();
  await s.ready();

  const result = await s.inject({
    method: request.method,
    url: request.url,
    headers: request.headers as Record<string, string>
  });

  reply.statusCode = result.statusCode;
  for (const [key, value] of Object.entries(result.headers)) {
    if (value !== undefined && value !== null) {
      reply.setHeader(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
  }
  reply.end(result.body);
}