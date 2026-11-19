import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { authenticateStation } from '@/lib/station-auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  station_id: z.string().optional(),
  timestamp: z.string().optional(),
});

export const POST = withErrors(async (req: Request) => {
  const { stationId } = await authenticateStation(req);
  const body = schema.parse(await req.json().catch(() => ({})));
  if (body.station_id && body.station_id !== stationId) {
    return ok({ ok: false, error: 'STATION_MISMATCH' }, 403);
  }
  const station = await prisma.station.update({
    where: { id: stationId },
    data: { lastSeen: new Date() },
  });
  return ok({
    ok: true,
    station_id: station.id,
    last_seen: station.lastSeen?.toISOString() ?? new Date().toISOString(),
    timestamp: body.timestamp ?? new Date().toISOString(),
  });
});
