import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeOrder } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  await requireRole(['EMPLOYEE']);
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? undefined;
  const stationId = url.searchParams.get('station_id') ?? undefined;
  const printerId = url.searchParams.get('printer_id') ?? undefined;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

  const where = {
    ...(status ? { status } : {}),
    ...(stationId ? { stationId } : {}),
    ...(printerId ? { printerId } : {}),
  };
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { payments: true, printJobs: true, user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return ok({
    orders: orders.map((order) => ({
      ...serializeOrder(order),
      customer: order.user,
    })),
    total,
  });
});
