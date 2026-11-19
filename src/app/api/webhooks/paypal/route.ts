import { fail, ok, withErrors } from '@/lib/api';
import { confirmOrderPaid, verifyPaypalEvent, type PaypalEvent } from '@/lib/payments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function extractOrderId(resource: Record<string, unknown>): string | null {
  const direct = resource.custom_id ?? resource.reference_id ?? resource.invoice_id;
  if (typeof direct === 'string' && direct) return direct;
  const units = Array.isArray(resource.purchase_units) ? resource.purchase_units : [];
  for (const unit of units) {
    const entry = asRecord(unit);
    const id = entry.custom_id ?? entry.reference_id;
    if (typeof id === 'string' && id) return id;
  }
  const supplementary = asRecord(resource.supplementary_data);
  const related = asRecord(supplementary.related_ids);
  return typeof related.order_id === 'string' ? related.order_id : null;
}

function extractAmount(resource: Record<string, unknown>): number {
  const direct = asRecord(resource.amount);
  const units = Array.isArray(resource.purchase_units) ? resource.purchase_units : [];
  const unit = units.length ? asRecord(units[0]) : {};
  const payments = asRecord(resource.payment);
  const captures = asRecord(payments.captions ?? payments.captures);
  const source = Object.keys(direct).length
    ? direct
    : Object.keys(asRecord(unit.amount)).length
      ? asRecord(unit.amount)
      : captures;
  return Number(source.value ?? 0) || 0;
}

export const POST = withErrors(async (req: Request) => {
  const event: PaypalEvent | null = await verifyPaypalEvent(req);
  if (!event) return fail('INVALID_SIGNATURE', 'Webhook de PayPal inválido', undefined, 400);

  const supported = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED'];
  const resource = asRecord(event.resource);
  const orderId = extractOrderId(resource);

  if (supported.includes(event.event_type) && orderId) {
    await confirmOrderPaid(
      orderId,
      'PAYPAL',
      String(resource.id ?? event.id),
      extractAmount(resource),
      { event_id: event.id, event_type: event.event_type },
    );
  }

  return ok({ received: true, event_id: event.id, type: event.event_type });
});
