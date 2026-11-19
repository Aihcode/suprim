import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeOrder } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ORDER_STATUSES = ['PENDING', 'PAID', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'];

const patchSchema = z.object({
  status: z.enum(ORDER_STATUSES as [string, ...string[]]).optional(),
  station_id: z.string().nullable().optional(),
  stationId: z.string().nullable().optional(),
  printer_id: z.string().nullable().optional(),
  printerId: z.string().nullable().optional(),
});

export const PATCH = withErrors(async (req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['EMPLOYEE']);
  const body = patchSchema.parse(await req.json());
  const order = await prisma.order.update({
    where: { id: params.id },
    data: {
      ...(body.status ? { status: body.status } : {}),
      ...(body.station_id !== undefined || body.stationId !== undefined
        ? { stationId: body.station_id ?? body.stationId ?? null }
        : {}),
      ...(body.printer_id !== undefined || body.printerId !== undefined
        ? { printerId: body.printer_id ?? body.printerId ?? null }
        : {}),
    },
    include: { payments: true, printJobs: true },
  });
  return ok({ order: serializeOrder(order) });
});
