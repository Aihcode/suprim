import type Stripe from 'stripe';

import { fail, ok, withErrors } from '@/lib/api';
import { confirmOrderPaid, verifyStripeEvent } from '@/lib/payments';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Los webhooks no pasan por rate limiting: se validan por firma criptográfica.

export const POST = withErrors(async (req: Request) => {
  const event = await verifyStripeEvent(req);
  if (!event) return fail('INVALID_SIGNATURE', 'Firma de Stripe inválida', undefined, 400);

  let orderId: string | null = null;
  let providerId = event.id;
  let amount = 0;

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    orderId = session.metadata?.orderId ?? session.client_reference_id ?? null;
    providerId =
      typeof session.payment_intent === 'string' ? session.payment_intent : session.id;
    amount = (session.amount_total ?? 0) / 100;
  } else if (
    event.type === 'payment_intent.succeeded' ||
    event.type === 'payment_intent.payment_failed'
  ) {
    const intent = event.data.object as Stripe.PaymentIntent;
    orderId = intent.metadata?.orderId ?? null;
    providerId = intent.id;
    amount = (intent.amount_received ?? intent.amount ?? 0) / 100;
  }

  if (orderId && event.type !== 'payment_intent.payment_failed') {
    await confirmOrderPaid(orderId, 'STRIPE', providerId, amount, {
      event_id: event.id,
      event_type: event.type,
      object: event.data.object,
    });
  } else if (orderId && event.type === 'payment_intent.payment_failed') {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (order && order.status === 'PENDING') {
      await prisma.order.update({ where: { id: orderId }, data: { status: 'FAILED' } });
    }
  }

  return ok({ received: true, event_id: event.id, type: event.type });
});
