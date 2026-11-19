import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

/** Error HTTP controlado, lanzado por requireAuth/requireRole y helpers. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Respuesta correcta con el formato del API_CONTRACT. */
export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Respuesta de error con el formato del API_CONTRACT:
 * { error, message, details }
 */
export function fail(
  errorCode: string,
  message: string,
  details?: unknown,
  status = 400,
): NextResponse {
  return NextResponse.json(
    { error: errorCode, message, details: details ?? {} },
    { status },
  );
}

/** Convierte cualquier excepción en una respuesta de error del contrato. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return fail(error.code, error.message, error.details, error.status);
  }
  if (error instanceof ZodError) {
    return fail(
      'VALIDATION_ERROR',
      'Datos de solicitud inválidos',
      error.flatten(),
      400,
    );
  }
  // Prisma: registro no encontrado
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2025'
  ) {
    return fail('NOT_FOUND', 'Recurso no encontrado', undefined, 404);
  }
  // Prisma: violación de unique
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  ) {
    return fail(
      'CONFLICT',
      'Ya existe un registro con esos datos',
      undefined,
      409,
    );
  }

  const message = error instanceof Error ? error.message : 'Error interno';
  console.error('[api] error no controlado:', error);
  return fail('INTERNAL_ERROR', message, undefined, 500);
}

/** Envuelve un handler de ruta para centralizar el manejo de errores. */
export function withErrors<T extends unknown[]>(
  handler: (...args: T) => Promise<NextResponse>,
): (...args: T) => Promise<NextResponse> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Atajo para lanzar errores HTTP desde cualquier helper. */
export function httpError(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): never {
  throw new HttpError(status, code, message, details);
}
