import { NextResponse } from 'next/server';
import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializePrinter, serializeStation } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  computer_name: z.string().min(1).max(120).optional(),
  computerName: z.string().min(1).max(120).optional(),
  os: z.enum(['WINDOWS', 'LINUX', 'MACOS']).optional(),
  active: z.boolean().optional(),
  token: z.string().optional(),
});

export const GET = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['EMPLOYEE']);
  const station = await prisma.station.findUnique({
    where: { id: params.id },
    include: { printers: true },
  });
  if (!station) return fail('STATION_NOT_FOUND', 'Estación no encontrada', undefined, 404);
  return ok({ station: { ...serializeStation(station), printers: station.printers.map(serializePrinter) } });
});

export const PATCH = withErrors(async (req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['EMPLOYEE']);
  const body = patchSchema.parse(await req.json());
  const station = await prisma.station.update({
    where: { id: params.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.computer_name || body.computerName ? { computerName: body.computer_name ?? body.computerName } : {}),
      ...(body.os ? { os: body.os } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.token ? { token: body.token } : {}),
    },
  });
  return ok({ station: serializeStation(station) });
});

export const DELETE = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['EMPLOYEE']);
  await prisma.station.delete({ where: { id: params.id } });
  return new NextResponse(null, { status: 204 });
});
