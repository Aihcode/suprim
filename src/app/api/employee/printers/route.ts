import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializePrinter } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const capabilitiesSchema = z.union([z.string(), z.record(z.unknown())]).optional();

const createSchema = z.object({
  name: z.string().min(1).max(160),
  type: z.enum(['LOCAL', 'NETWORK', 'SHARED']).default('LOCAL'),
  ip: z.string().max(100).optional(),
  port: z.coerce.number().int().positive().optional(),
  protocol: z.enum(['IPP', 'CUPS', 'RAW', 'SMB']).optional(),
  capabilities: capabilitiesSchema,
  status: z.string().max(40).optional(),
  station_id: z.string().optional(),
  stationId: z.string().optional(),
});

export const GET = withErrors(async (req: Request) => {
  await requireRole(['EMPLOYEE']);
  const url = new URL(req.url);
  const stationId = url.searchParams.get('station_id') ?? undefined;
  const printers = await prisma.printer.findMany({
    where: stationId ? { stationId } : undefined,
    include: { station: true, statusLogs: { orderBy: { recordedAt: 'desc' }, take: 5 } },
    orderBy: { createdAt: 'desc' },
  });
  return ok({
    printers: printers.map((p) => ({
      ...serializePrinter(p),
      station_name: p.station?.name ?? null,
      recent_logs: p.statusLogs.map((log) => ({ status: log.status, message: log.message, timestamp: log.recordedAt.toISOString() })),
    })),
  });
});

export const POST = withErrors(async (req: Request) => {
  await requireRole(['EMPLOYEE']);
  const body = createSchema.parse(await req.json());
  const printer = await prisma.printer.create({
    data: {
      name: body.name,
      type: body.type,
      ip: body.ip ?? null,
      port: body.port ?? null,
      protocol: body.protocol ?? null,
      capabilities: JSON.stringify(body.capabilities ?? { color: true, duplex: true, trays: [], paper_sizes: ['A4', 'LETTER'] }),
      status: body.status ?? 'OFFLINE',
      stationId: body.station_id ?? body.stationId ?? null,
    },
  });
  return ok({ printer: serializePrinter(printer) }, 201);
});
