import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { dec } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function optionalDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export const GET = withErrors(async (req: Request) => {
  await requireRole(['ADMIN']);
  const url = new URL(req.url);
  const from = optionalDate(url.searchParams.get('from'));
  const to = optionalDate(url.searchParams.get('to'));
  const dateFilter = from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {};

  const [totals, paid, byStatus, users, stations, jobs] = await Promise.all([
    prisma.order.aggregate({ where: dateFilter, _count: { _all: true }, _sum: { pages: true, copies: true } }),
    prisma.order.aggregate({
      where: { ...dateFilter, status: { in: ['PAID', 'PROCESSING', 'COMPLETED'] } },
      _sum: { totalPrice: true, discount: true },
      _count: { _all: true },
    }),
    prisma.order.groupBy({ by: ['status'], where: dateFilter, _count: { _all: true } }),
    prisma.user.count(),
    prisma.station.count(),
    prisma.printJob.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  return ok({
    period: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
    orders: {
      total: totals._count._all,
      paid: paid._count._all,
      by_status: byStatus.map((item) => ({ status: item.status, count: item._count._all })),
    },
    revenue: dec(paid._sum.totalPrice),
    discounts: dec(paid._sum.discount),
    pages: {
      total: totals._sum.pages ?? 0,
      printed_copies: (totals._sum.pages ?? 0) * (totals._sum.copies ?? 0),
    },
    users,
    stations,
    jobs: jobs.map((item) => ({ status: item.status, count: item._count._all })),
  });
});
