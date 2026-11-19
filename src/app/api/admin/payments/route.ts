import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { dec, serializePayment } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  await requireRole(['ADMIN']);
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

  const payments = await prisma.payment.findMany({
    where: { ...(provider ? { provider } : {}), ...(status ? { status } : {}) },
    include: { order: { select: { id: true, fileName: true, userId: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return ok({
    payments: payments.map((payment) => ({ ...serializePayment(payment), order: payment.order })),
    total: payments.length,
    revenue: payments.reduce((sum, payment) => sum + dec(payment.amount), 0),
  });
});
