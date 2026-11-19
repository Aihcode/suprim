/**
 * Cliente HTTP liviano para las API Routes del contrato (`API_CONTRACT.md`).
 * Añade credenciales (cookies de NextAuth), serializa JSON cuando corresponde
 * y normaliza el formato de error `{ error, message, details }`.
 */

import { captureException } from '@/lib/logrocket';

export interface ApiErrorBody {
  error?: string;
  message?: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message || code || `Error HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;

  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (!isFormData && init.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: init.credentials ?? 'include',
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const body = asRecord(payload);
    const code = readString(body.error, `http_${response.status}`);
    const message = readString(body.message, code);
    const apiError = new ApiError(response.status, code, message, body.details);
    // Solo errores de servidor: los 4xx son parte del flujo normal (validación, RBAC).
    if (response.status >= 500) captureException(apiError);
    throw apiError;
  }

  return payload as T;
}

export function errorMessage(error: unknown, fallback = 'Ocurrió un error inesperado'): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/* ---------------------------- Lectura segura ---------------------------- */

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Extrae una lista de respuestas como `[]`, `{ orders: [] }`, `{ data: { items: [] } }`… */
export function unwrapList<T>(value: unknown, keys: string[] = []): T[] {
  if (Array.isArray(value)) return value as T[];
  const root = asRecord(value);
  for (const key of [...keys, 'data', 'items', 'results', 'rows', 'list']) {
    const candidate = root[key];
    if (Array.isArray(candidate)) return candidate as T[];
    if (candidate !== null && typeof candidate === 'object') {
      const nested = asRecord(candidate);
      for (const nestedKey of keys) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as T[];
      }
    }
  }
  for (const candidate of Object.values(root)) {
    if (Array.isArray(candidate)) return candidate as T[];
  }
  return [];
}

export function readString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return fallback;
  return fallback;
}

export function readNumber(value: unknown, fallback = 0): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'si', 'active'].includes(value.toLowerCase());
  return fallback;
}

/** Busca el primer valor numérico entre varias claves candidatas (incluye un nivel anidado). */
export function pickNumber(source: unknown, keys: string[], fallback = 0): number {
  const root = asRecord(source);
  for (const key of keys) {
    if (root[key] !== undefined) {
      const value = readNumber(root[key], Number.NaN);
      if (Number.isFinite(value)) return value;
    }
  }
  for (const value of Object.values(root)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nested = pickNumber(value, keys, Number.NaN);
      if (Number.isFinite(nested)) return nested;
    }
  }
  return fallback;
}

/* --------------------------- Tipos del dominio -------------------------- */

export interface JobProgress {
  job_id?: string;
  order_id?: string;
  status?: string;
  page_current?: number;
  page_total?: number;
  message?: string;
  timestamp?: string;
  station_id?: string;
  station_name?: string;
  printer_id?: string;
  [key: string]: unknown;
}

export interface Payment {
  id?: string;
  order_id?: string;
  provider?: string;
  provider_id?: string;
  amount?: number | string;
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface Order {
  id: string;
  user_id?: string | null;
  user?: Record<string, unknown>;
  file_name?: string;
  file_url?: string;
  pages?: number;
  copies?: number;
  color?: boolean;
  duplex?: boolean;
  paper_size?: string;
  total_price?: number | string;
  base_price?: number | string;
  discount?: number | string;
  free_pages?: number;
  status?: string;
  payment_provider?: string | null;
  payment_id?: string | null;
  checkout_url?: string;
  payment_url?: string;
  payments?: Payment[];
  progress?: JobProgress;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface Station {
  id?: string;
  name?: string;
  computer_name?: string;
  os?: string;
  token?: string;
  last_seen?: string | null;
  active?: boolean;
  is_active?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

export interface Printer {
  id?: string;
  name?: string;
  type?: string;
  ip?: string | null;
  port?: number | null;
  protocol?: string | null;
  status?: string;
  message?: string;
  capabilities?: Record<string, unknown> | string | null;
  station_id?: string | null;
  [key: string]: unknown;
}

export interface AppUser {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  active?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

export interface DiscountRule {
  id?: string;
  name?: string;
  type?: string;
  threshold?: number | null;
  value?: number | string;
  active?: boolean;
  [key: string]: unknown;
}

export interface QuoteResult {
  base_price?: number | string;
  discount?: number | string;
  free_pages?: number;
  total_price?: number | string;
  breakdown?: unknown;
  [key: string]: unknown;
}

export interface FreePagesData {
  balance?: number;
  total?: number;
  used?: number;
  history?: unknown[];
  entries?: unknown[];
  [key: string]: unknown;
}

export interface CreateOrderResponse {
  order?: Order;
  id?: string;
  payment_url?: string;
  checkout_url?: string;
  [key: string]: unknown;
}

export interface PayResponse {
  checkout_url?: string;
  payment_url?: string;
  url?: string;
  [key: string]: unknown;
}
