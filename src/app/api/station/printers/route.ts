import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { serializePrinter } from '@/lib/serialize';
import { authenticateStation } from '@/lib/station-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const printerSchema = z.object({
  printer_id: z.string().optional(),
  printerId: z.string().optional(),
  id: z.string().optional(),
  name: z.string().min(1).max(160),
  type: z.enum(['LOCAL', 'NETWORK', 'SHARED']).default('LOCAL'),
  ip: z.string().max(100).optional(),
  port: z.coerce.number().int().positive().optional(),
  protocol: z.enum(['IPP', 'CUPS', 'RAW', 'SMB']).optional(),
  capabilities: z.union([z.string(), z.record(z.unknown())]).optional(),
  status: z.string().max(40).optional(),
});

const bodySchema = z.object({
  printer: printerSchema.optional(),
  printers: z.array(printerSchema).max(200).optional(),
});

export const GET = withErrors(async (req: Request) => {
  const { stationId } = await authenticateStation(req);
  const printers = await prisma.printer.findMany({
    where: { stationId },
    include: { statusLogs: { orderBy: { recordedAt: 'desc' }, take: 1 } },
  });
  return ok({
    station_id: stationId,
    printers: printers.map((p) => ({
      ...serializePrinter(p),
      last_status: p.statusLogs[0]?.status ?? null,
    })),
  });
});

/** El agente reporta las impresoras descubiertas (locales, IPP, RAW, SMB...). */
export const POST = withErrors(async (req: Request) => {
  const { stationId } = await authenticateStation(req);
  const body = bodySchema.parse(await req.json());
  const items = body.printers ?? (body.printer ? [body.printer] : []);
  const saved = [];

  for (const item of items) {
    const explicitId = item.id ?? item.printer_id ?? item.printerId;
    const existing = explicitId
      ? await prisma.printer.findUnique({ where: { id: explicitId } })
      : await prisma.printer.findFirst({ where: { name: item.name, stationId } });

    const data = {
      name: item.name,
      type: item.type,
      ip: item.ip ?? null,
      port: item.port ?? null,
      protocol: item.protocol ?? null,
      capabilities:
        typeof item.capabilities === 'string'
          ? item.capabilities
          : JSON.stringify(item.capabilities ?? {}),
      ...(item.status ? { status: item.status.toUpperCase() } : {}),
      stationId,
    };

    const printer = existing
      ? await prisma.printer.update({ where: { id: existing.id }, data })
      : await prisma.printer.create({ data: { id: explicitId, ...data } });

    if (item.status) {
      await prisma.printerStatusLog.create({
        data: { printerId: printer.id, status: item.status.toUpperCase() },
      });
    }
    saved.push(serializePrinter(printer));
  }

  return ok({ station_id: stationId, printers: saved, count: saved.length }, 201);
});
