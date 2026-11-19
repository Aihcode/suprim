import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { signStationToken } from '@/lib/station-auth';
import { serializeStation } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  computer_name: z.string().min(1).max(120).optional(),
  computerName: z.string().min(1).max(120).optional(),
  os: z.enum(['WINDOWS', 'LINUX', 'MACOS']).default('WINDOWS'),
  token: z.string().optional(),
});

export const GET = withErrors(async () => {
  await requireRole(['EMPLOYEE']);
  const stations = await prisma.station.findMany({
    include: { printers: true, _count: { select: { printJobs: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok({ stations: stations.map((s) => ({ ...serializeStation(s), printer_count: s.printers.length, job_count: s._count.printJobs })) });
});

export const POST = withErrors(async (req: Request) => {
  await requireRole(['EMPLOYEE']);
  const body = createSchema.parse(await req.json());
  const id = randomUUID();
  const token = body.token || signStationToken(id);

  const station = await prisma.station.create({
    data: {
      id,
      name: body.name,
      token,
      computerName: body.computer_name ?? body.computerName ?? body.name,
      os: body.os,
      active: true,
    },
  });
  return ok({ station: serializeStation(station) }, 201);
});
