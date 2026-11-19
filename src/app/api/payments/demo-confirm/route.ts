import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { confirmOrderPaid } from '@/lib/payments';
import { prisma } from '@/lib/prisma';
import { serializeOrder } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  order_id: z.string().min(1),
  provider_id: z.string().optional(),
});

/** Confirmación local de pago. Solo disponible con DEMO_PAYMENTS=true. */
export const POST = withErrors(async (req: Request) => {
  if (String(process.env.DEMO_PAYMENTS || '').toLowerCase() !== 'true') {
    return fail('DEMO_DISABLED', 'Los pagos demo están desactivados', undefined, 403);
  }

  const body = schema.parse(await req.json());
  const order = await prisma.order.findUnique({ where: { id: body.order_id } });
  if (!order) return fail('ORDER_NOT_FOUND', 'Orden no encontrada', undefined, 404);

  const result = await confirmOrderPaid(
    order.id,
    'DEMO',
    body.provider_id ?? `demo_${order.id}`,
    Number(order.totalPrice),
    { mode: 'demo', order_id: order.id },
  );

  return ok({
    ok: true,
    demo: true,
    already_processed: result.alreadyProcessed,
    order: result.order ? serializeOrder(result.order) : null,
    job_id: result.job?.id ?? null,
  });
});
