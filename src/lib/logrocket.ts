/**
 * Integración opcional de LogRocket con el frontend.
 *
 * - Se activa SOLO si `NEXT_PUBLIC_LOGROCKET_APP_ID` está definido en `.env`.
 * - Carga el SDK oficial desde CDN (no añade dependencias ni afecta el build).
 * - Sanea por defecto contraseñas, tokens, emails y cabeceras de autorización:
 *   nunca se envían secretos de estaciones ni datos de pago a LogRocket.
 * - Todas las funciones son no-op en servidor o cuando la variable no existe.
 */

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-station-token',
  'x-csrf-token',
]);

const SENSITIVE_FIELD = /password|passwd|secret|token|api[_-]?key|authorization|credit[_-]?card|card[_-]?number|cvv/i;

interface LogRocketRequest {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  [key: string]: unknown;
}

interface LogRocketResponse {
  url?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  [key: string]: unknown;
}

export interface LogRocketInstance {
  init(appId: string, options?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  track(event: string, properties?: Record<string, unknown>): void;
  captureException(error: unknown): void;
}

declare global {
  interface Window {
    LogRocket?: LogRocketInstance;
  }
}

let initPromise: Promise<boolean> | null = null;

function appId(): string {
  return (process.env.NEXT_PUBLIC_LOGROCKET_APP_ID || '').trim();
}

export function isLogRocketEnabled(): boolean {
  return Boolean(appId()) && typeof window !== 'undefined';
}

function redactHeaders(headers?: Record<string, string>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers || {})) {
    safe[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return safe;
}

function redactBody(body: unknown): unknown {
  if (typeof body === 'string' && SENSITIVE_FIELD.test(body)) return '[REDACTED]';
  if (body && typeof body === 'object') {
    try {
      const clone: Record<string, unknown> = JSON.parse(JSON.stringify(body));
      for (const key of Object.keys(clone)) {
        if (SENSITIVE_FIELD.test(key)) clone[key] = '[REDACTED]';
      }
      return clone;
    } catch {
      return '[REDACTED]';
    }
  }
  return body;
}

function initSdk(): boolean {
  const sdk = window.LogRocket;
  if (!sdk) return false;
  sdk.init(appId(), {
    release: process.env.NEXT_PUBLIC_LOGROCKET_RELEASE || undefined,
    network: {
      requestSanitizer(request: LogRocketRequest) {
        if (SENSITIVE_FIELD.test(request.url || '')) return null;
        return {
          ...request,
          headers: redactHeaders(request.headers),
          body: redactBody(request.body),
        };
      },
      responseSanitizer(response: LogRocketResponse) {
        return {
          ...response,
          headers: redactHeaders(response.headers),
          body: redactBody(response.body),
        };
      },
    },
    dom: {
      inputSanitizer(value: string, element: HTMLElement | null) {
        const input = element as HTMLInputElement | null;
        const type = (input?.type || '').toLowerCase();
        if (['password', 'email', 'tel', 'number', 'hidden'].includes(type)) return '';
        if (input?.getAttribute?.('data-lp-sensitive') === 'true') return '';
        if (SENSITIVE_FIELD.test(input?.name || input?.id || '')) return '';
        return value;
      },
      textSanitizer(text: string, element: HTMLElement | null) {
        return element?.getAttribute?.('data-lp-sensitive') === 'true' ? '' : text;
      },
    },
  });
  return true;
}

/** Carga el SDK una sola vez. Devuelve `false` cuando LogRocket está desactivado. */
export function initLogRocket(): Promise<boolean> {
  if (!isLogRocketEnabled()) return Promise.resolve(false);
  if (window.LogRocket) return Promise.resolve(initSdk());
  if (initPromise) return initPromise;

  const cdn = process.env.NEXT_PUBLIC_LOGROCKET_CDN || 'https://cdn.logrocket.io/LogRocket.min.js';
  initPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = cdn;
    script.onload = () => resolve(initSdk());
    script.onerror = () => {
      console.warn('[logrocket] No se pudo cargar el SDK; la app sigue funcionando sin observabilidad.');
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return initPromise;
}

/** Asocia la sesión autenticada con el session replay de LogRocket. */
export function identifyUser(
  userId: string,
  traits: Record<string, unknown> = {},
): void {
  if (!isLogRocketEnabled() || !window.LogRocket) return;
  try {
    window.LogRocket.identify(userId, traits);
  } catch {
    // La observabilidad nunca debe romper el flujo del usuario.
  }
}

/** Registra un evento de producto (checkout, progreso de impresión, etc.). */
export function trackEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (!isLogRocketEnabled() || !window.LogRocket) return;
  try {
    window.LogRocket.track(event, properties);
  } catch {
    // no-op
  }
}

/** Envía errores no controlados o fallos relevantes de API. */
export function captureException(error: unknown): void {
  if (!isLogRocketEnabled() || !window.LogRocket) return;
  try {
    window.LogRocket.captureException(error);
  } catch {
    // no-op
  }
}
