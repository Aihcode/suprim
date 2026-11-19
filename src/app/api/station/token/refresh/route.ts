import { ok, withErrors } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { authenticateStation, signStationToken } from '@/lib/station-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXPIRES_IN_SECONDS = 365 * 24 * 60 * 60;

export const POST = withErrors(async (req: Request) => {
  const { stationId } = await authenticateStation(req);
  const token = signStationToken(stationId, '365d');
  await prisma.station.update({ where: { id: stationId }, data: { token } });
  return ok({
    station_id: stationId,
    token,
    token_type: 'Bearer',
    expires_in: EXPIRES_IN_SECONDS,
    expires_at: new Date(Date.now() + EXPIRES_IN_SECONDS * 1000).toISOString(),
  });
});
