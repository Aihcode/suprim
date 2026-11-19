/**
 * Rate limit en memoria (por IP o por token de estación).
 * Sin dependencias de Node: compatible con el middleware Edge de Next.js.
 * Los webhooks NO usan este módulo (se validan criptográficamente).
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;
const PUBLIC_LIMIT = 60;
const STATION_LIMIT = 30;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number;
}

function consume(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, limit, remaining: limit - 1, retryAfter: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - current.count),
    retryAfter: 0,
  };
}

/** 60 peticiones/minuto por IP para rutas públicas. */
export function publicRateLimit(key: string): RateLimitResult {
  return consume(`public:${key}`, PUBLIC_LIMIT);
}

/** 30 peticiones/minuto por token/IP para rutas de estación. */
export function stationRateLimit(key: string): RateLimitResult {
  return consume(`station:${key}`, STATION_LIMIT);
}

/** Las rutas de webhook están explícitamente excluidas del rate limit. */
export function isWebhookPath(pathname: string): boolean {
  return pathname.startsWith('/api/webhooks/');
}

/** Limpieza defensiva de buckets antiguos (opcional, evita crecimiento). */
export function pruneBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}
