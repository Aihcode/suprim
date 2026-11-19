import { assertOwnerOrStaff, requireRole } from '@/lib/auth';
import { fail, ok, withErrors } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { serializeOrder, serializePayment, serializeJob } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole(['CLIENT']);
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { payments: true, printJobs: { include: { progress: true } } },
  });
  if (!order) return fail('ORDER_NOT_FOUND', 'Orden no encontrada', undefined, 404);
  assertOwnerOrStaff(user, order.userId);

  return ok({
    ...serializeOrder(order),
    order: serializeOrder(order),
    payments: order.payments.map(serializePayment),
    jobs: order.printJobs.map(serializeJob),
  });
});
