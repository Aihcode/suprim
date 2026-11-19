import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { requireRole, assertOwnerOrStaff } from '@/lib/auth';
import { createCheckout } from '@/lib/payments';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paySchema = z.object({
  provider: z.enum(['STRIPE', 'PAYPAL', 'DEMO']).default('STRIPE'),
});

export const POST = withErrors(async (req: Request, { params }: { params: { id: string } }) => {
  const user = await requireRole(['CLIENT']);
  const body = paySchema.parse(await req.json().catch(() => ({})));
  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order) return fail('ORDER_NOT_FOUND', 'Orden no encontrada', undefined, 404);
  assertOwnerOrStaff(user, order.userId);

  if (order.status === 'PAID' || order.status === 'COMPLETED') {
    return fail('ORDER_ALREADY_PAID', 'La orden ya fue pagada', undefined, 409);
  }
  if (order.status === 'CANCELLED') {
    return fail('ORDER_CANCELLED', 'La orden está cancelada', undefined, 409);
  }

  const checkout = await createCheckout(order, body.provider);
  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentProvider: checkout.demo ? 'DEMO' : checkout.provider,
      paymentId: checkout.payment_id,
    },
  });

  return ok(checkout);
});
