import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializePrinter } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  type: z.enum(['LOCAL', 'NETWORK', 'SHARED']).optional(),
  ip: z.string().max(100).nullable().optional(),
  port: z.coerce.number().int().positive().nullable().optional(),
  protocol: z.enum(['IPP', 'CUPS', 'RAW', 'SMB']).nullable().optional(),
  capabilities: z.union([z.string(), z.record(z.unknown())]).optional(),
  status: z.string().max(40).optional(),
  station_id: z.string().nullable().optional(),
  stationId: z.string().nullable().optional(),
});

export const PATCH = withErrors(async (req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['EMPLOYEE']);
  const body = patchSchema.parse(await req.json());
  const printer = await prisma.printer.update({
    where: { id: params.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.type ? { type: body.type } : {}),
      ...(body.ip !== undefined ? { ip: body.ip } : {}),
      ...(body.port !== undefined ? { port: body.port } : {}),
      ...(body.protocol !== undefined ? { protocol: body.protocol } : {}),
      ...(body.capabilities !== undefined
        ? { capabilities: typeof body.capabilities === 'string' ? body.capabilities : JSON.stringify(body.capabilities) }
        : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.station_id !== undefined || body.stationId !== undefined
        ? { stationId: body.station_id ?? body.stationId ?? null }
        : {}),
    },
  });
  return ok({ printer: serializePrinter(printer) });
});
