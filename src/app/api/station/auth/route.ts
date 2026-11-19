import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { serializeStation } from '@/lib/serialize';
import { verifyStationToken } from '@/lib/station-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const authSchema = z.object({
  station_id: z.string().min(1),
  token: z.string().min(1),
  computer_name: z.string().max(160).optional(),
  os: z.enum(['WINDOWS', 'LINUX', 'MACOS']).optional(),
  capabilities: z.array(z.string()).optional(),
});

export const POST = withErrors(async (req: Request) => {
  const body = authSchema.parse(await req.json());
  const identity = verifyStationToken(body.token);
  if (!identity || identity.stationId !== body.station_id) {
    return fail('INVALID_STATION_TOKEN', 'Token de estación inválido', undefined, 401);
  }

  const station = await prisma.station.findUnique({ where: { id: body.station_id } });
  if (!station) return fail('STATION_NOT_FOUND', 'Estación no registrada', undefined, 401);
  if (!station.active) return fail('STATION_INACTIVE', 'La estación está desactivada', undefined, 403);

  const updated = await prisma.station.update({
    where: { id: station.id },
    data: {
      lastSeen: new Date(),
      ...(body.computer_name ? { computerName: body.computer_name } : {}),
      ...(body.os ? { os: body.os } : {}),
    },
  });

  return ok({
    station_id: station.id,
    station: serializeStation(updated),
    capabilities: body.capabilities ?? [],
    authenticated: true,
  });
});
