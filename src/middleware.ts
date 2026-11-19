import { NextResponse, type NextRequest } from 'next/server';

import {
  isWebhookPath,
  publicRateLimit,
  stationRateLimit,
} from '@/lib/rate-limit';

/**
 * Rate limiting global de API. Los webhooks están excluidos explícitamente:
 * se validan con firma criptográfica (Stripe/PayPal) y deben poder reintentar.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isWebhookPath(pathname)) return NextResponse.next();

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local';
  const isStation = pathname.startsWith('/api/station/');
  const key = isStation ? request.headers.get('authorization') || ip : ip;
  const result = isStation ? stationRateLimit(key) : publicRateLimit(key);

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: 'RATE_LIMITED',
        message: 'Demasiadas peticiones. Intenta de nuevo en unos segundos.',
        details: { limit: result.limit, retry_after: result.retryAfter },
      },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/api/quote/:path*',
    '/api/auth/register',
    '/api/station/:path*',
  ],
};
