import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Station } from '@prisma/client';

import { HttpError } from '@/lib/api';
import { prisma } from '@/lib/prisma';

export interface StationIdentity {
  stationId: string;
  station: Station;
}

function secret(): string {
  return process.env.JWT_SECRET || 'dev-station-secret';
}

/** Genera el JWT de estación firmado HS256 (1 año por defecto). */
export function signStationToken(stationId: string, expiresIn: string | number = '365d'): string {
  return jwt.sign({ stationId, sub: stationId, type: 'station' }, secret(), {
    algorithm: 'HS256',
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
}

/** Verifica el token y devuelve el id de estación, o null si es inválido. */
export function verifyStationToken(token: string): { stationId: string } | null {
  try {
    const decoded = jwt.verify(token, secret(), { algorithms: ['HS256'] }) as JwtPayload;
    const stationId = decoded.stationId ?? decoded.station_id ?? decoded.sub;
    if (typeof stationId !== 'string' || !stationId) return null;
    return { stationId };
  } catch {
    return null;
  }
}

/** Autenticación REST: cabecera Authorization: Bearer <station_token>. */
export async function authenticateStation(req: Request): Promise<StationIdentity> {
  const header = req.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Falta el header Bearer de estación');
  }
  const identity = verifyStationToken(match[1]);
  if (!identity) {
    throw new HttpError(401, 'INVALID_STATION_TOKEN', 'Token de estación inválido o expirado');
  }
  const station = await prisma.station.findUnique({ where: { id: identity.stationId } });
  if (!station) {
    throw new HttpError(401, 'STATION_NOT_FOUND', 'Estación no registrada');
  }
  if (!station.active) {
    throw new HttpError(403, 'STATION_INACTIVE', 'La estación está desactivada');
  }
  return { stationId: station.id, station };
}
