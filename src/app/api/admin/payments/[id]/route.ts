import { fail, ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializePayment } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['ADMIN']);
  const payment = await prisma.payment.findUnique({
    where: { id: params.id },
    include: { order: { include: { user: { select: { id: true, name: true, email: true } } } } },
  });
  if (!payment) return fail('PAYMENT_NOT_FOUND', 'Pago no encontrado', undefined, 404);
  return ok({
    ...serializePayment(payment),
    payment: serializePayment(payment),
    order: payment.order,
    customer: payment.order.user,
  });
});
