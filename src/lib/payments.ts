import Stripe from 'stripe';

import { HttpError } from '@/lib/api';
import { createPrintJob, dispatchJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { emitToAll } from '@/lib/realtime';
import { dec, serializeOrder } from '@/lib/serialize';

/**
 * Pagos: Stripe Checkout / PayPal Orders con fallback DEMO local.
 * Ningún trabajo se envía a la estación sin confirmación de pago (webhook o
 * confirmación demo autorizada por DEMO_PAYMENTS=true).
 */

export type PaymentProvider = 'STRIPE' | 'PAYPAL' | 'DEMO';

export interface ChargeableOrder {
  id: string;
  fileName: string;
  totalPrice: unknown;
  stationId?: string | null;
  printerId?: string | null;
  pages?: number;
}

export interface CheckoutResult {
  checkout_url: string;
  provider: PaymentProvider;
  payment_id: string;
  demo: boolean;
}

export interface PaypalEvent {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
  [key: string]: unknown;
}

let stripeClient: Stripe | null = null;

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(key, { typescript: true });
  }
  return stripeClient;
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function demoEnabled(): boolean {
  return String(process.env.DEMO_PAYMENTS || '').toLowerCase() === 'true';
}

/** Crea una sesión de pago y devuelve la URL a la que redirigir al cliente. */
export async function createCheckout(
  order: ChargeableOrder,
  provider: string,
): Promise<CheckoutResult> {
  const normalized = provider.toUpperCase();
  const amount = Math.max(0, dec(order.totalPrice));

  if (normalized === 'DEMO' || demoEnabled() || (!getStripe() && normalized !== 'PAYPAL')) {
    if (normalized === 'PAYPAL' && process.env.PAYPAL_CLIENT_ID && !demoEnabled()) {
      // Se prefiere PayPal real si hay credenciales y el modo demo no está activo.
    } else {
      const paymentId = `demo_${order.id}_${Date.now()}`;
      return {
        checkout_url: `${appUrl()}/checkout/${order.id}/demo`,
        provider: 'DEMO',
        payment_id: paymentId,
        demo: true,
      };
    }
  }

  if (normalized === 'STRIPE') {
    const stripe = getStripe();
    if (!stripe) throw new HttpError(400, 'PAYMENT_UNAVAILABLE', 'Stripe no está configurado');
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: order.id,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `Impresión — ${order.fileName}` },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: { orderId: order.id },
      success_url: `${appUrl()}/checkout/${order.id}?status=success`,
      cancel_url: `${appUrl()}/checkout/${order.id}?status=cancelled`,
    });
    return {
      checkout_url: session.url ?? `${appUrl()}/checkout/${order.id}`,
      provider: 'STRIPE',
      payment_id: session.id,
      demo: false,
    };
  }

  if (normalized === 'PAYPAL') {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new HttpError(400, 'PAYMENT_UNAVAILABLE', 'PayPal no está configurado');
    }
    const api = paypalApiUrl();
    const tokenRes = await fetch(`${api}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) throw new HttpError(502, 'PAYPAL_ERROR', 'No se pudo autenticar con PayPal');
    const token = (await tokenRes.json()) as { access_token: string };

    const orderRes = await fetch(`${api}/v1/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: order.id,
            custom_id: order.id,
            amount: { currency_code: 'USD', value: amount.toFixed(2) },
          },
        ],
        application_context: {
          return_url: `${appUrl()}/checkout/${order.id}?status=success`,
          cancel_url: `${appUrl()}/checkout/${order.id}?status=cancelled`,
        },
      }),
    });
    if (!orderRes.ok) throw new HttpError(502, 'PAYPAL_ERROR', 'No se pudo crear la orden de PayPal');
    const paypalOrder = (await orderRes.json()) as {
      id: string;
      links?: { rel: string; href: string }[];
    };
    const approval = paypalOrder.links?.find((link) => link.rel === 'approve')?.href;
    return {
      checkout_url: approval ?? `${appUrl()}/checkout/${order.id}`,
      provider: 'PAYPAL',
      payment_id: paypalOrder.id,
      demo: false,
    };
  }

  throw new HttpError(400, 'INVALID_PROVIDER', 'Proveedor de pago no soportado');
}

function paypalApiUrl(): string {
  return process.env.PAYPAL_MODE === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

/**
 * Confirma un pago con idempotencia: WebhookEvent + Payment únicos.
 * Actualiza la orden a PAID, crea el PrintJob y notifica a la estación.
 */
export async function confirmOrderPaid(
  orderId: string,
  provider: string,
  providerId: string,
  amount: number,
  webhookData?: Record<string, unknown>,
) {
  const normalized = provider.toUpperCase();
  const eventKey = `${normalized.toLowerCase()}:${providerId}`;

  const existingEvent = await prisma.webhookEvent.findUnique({ where: { id: eventKey } });
  if (existingEvent) {
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true, printJobs: true },
    });
    return { alreadyProcessed: true as const, order: existingOrder, job: null };
  }

  const existingPayment = await prisma.payment.findUnique({ where: { providerId } });
  if (existingPayment) {
    await prisma.webhookEvent.upsert({
      where: { id: eventKey },
      create: { id: eventKey, provider: normalized, type: 'PAYMENT_CONFIRMED' },
      update: {},
    });
    const existingOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true, printJobs: true },
    });
    return { alreadyProcessed: true as const, order: existingOrder, job: null };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Orden no encontrada');

  // Segunda barrera de idempotencia: distintos eventos del mismo pago (p. ej.
  // checkout.session.completed + payment_intent.succeeded) no deben duplicar jobs.
  if (['PAID', 'PROCESSING', 'COMPLETED'].includes(order.status)) {
    const paidOrder = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: true, printJobs: true },
    });
    return { alreadyProcessed: true as const, order: paidOrder, job: null };
  }

  if (amount > 0 && Math.abs(amount - dec(order.totalPrice)) > 0.01) {
    throw new HttpError(400, 'AMOUNT_MISMATCH', 'El monto confirmado no coincide con la orden', {
      expected: dec(order.totalPrice),
      received: amount,
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.webhookEvent.create({
      data: { id: eventKey, provider: normalized, type: 'PAYMENT_CONFIRMED' },
    });
    await tx.payment.create({
      data: {
        orderId,
        provider: normalized,
        providerId,
        amount,
        status: 'COMPLETED',
        webhookData: webhookData ? JSON.stringify(webhookData) : null,
      },
    });
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'PAID',
        paymentProvider: normalized === 'DEMO' ? null : normalized,
        paymentId: providerId,
      },
    });
    // Las páginas gratis aplicadas a la cotización se consumen al pagar.
    if (order.freePages > 0) {
      const customer = await tx.user.findUnique({
        where: { id: order.userId },
        select: { freePages: true },
      });
      if (customer) {
        await tx.user.update({
          where: { id: order.userId },
          data: { freePages: Math.max(0, customer.freePages - order.freePages) },
        });
      }
    }
  });

  let stationId = order.stationId;
  if (!stationId) {
    const activeStation = await prisma.station.findFirst({ where: { active: true } });
    stationId = activeStation?.id ?? null;
  }

  const job = await createPrintJob({
    orderId,
    stationId,
    printerId: order.printerId,
    pageTotal: Math.max(1, order.pages * order.copies),
  });

  const dispatch = await dispatchJob(job);
  const updatedOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true, printJobs: true },
  });

  emitToAll('order.paid', { order: serializeOrder(updatedOrder ?? order) });
  emitToAll('order.updated', { id: orderId, status: 'PAID' });

  return {
    alreadyProcessed: false as const,
    order: updatedOrder ?? order,
    job,
    emitted: dispatch.emitted,
  };
}

/** Verifica la firma de Stripe sobre el body crudo de la petición. */
export async function verifyStripeEvent(req: Request): Promise<Stripe.Event | null> {
  const signature = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return null;
  const payload = await req.text();
  try {
    return Stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.warn('[stripe] firma inválida:', error);
    return null;
  }
}

/** Verifica un webhook de PayPal contra su API oficial. */
export async function verifyPaypalEvent(req: Request): Promise<PaypalEvent | null> {
  const raw = await req.text();
  let parsed: PaypalEvent;
  try {
    parsed = JSON.parse(raw) as PaypalEvent;
  } catch {
    return null;
  }

  const requiredHeaders = [
    'paypal-transmission-id',
    'paypal-transmission-time',
    'paypal-cert-url',
    'paypal-auth-algo',
    'paypal-signature',
  ];
  if (requiredHeaders.some((header) => !req.headers.get(header))) return null;

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!clientId || !clientSecret || !webhookId) {
    // Sin credenciales solo se puede operar en modo demo.
    return demoEnabled() ? parsed : null;
  }

  try {
    const tokenRes = await fetch(`${paypalApiUrl()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const token = (await tokenRes.json()) as { access_token: string };
    const verification = await fetch(`${paypalApiUrl()}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: req.headers.get('paypal-auth-algo'),
        cert_url: req.headers.get('paypal-cert-url'),
        transmission_id: req.headers.get('paypal-transmission-id'),
        transmission_sig: req.headers.get('paypal-signature'),
        transmission_time: req.headers.get('paypal-transmission-time'),
        webhook_id: webhookId,
        webhook_event: parsed,
      }),
    });
    const result = (await verification.json()) as { verification_status?: string };
    return result.verification_status === 'SUCCESS' ? parsed : null;
  } catch (error) {
    console.warn('[paypal] verificación fallida:', error);
    return null;
  }
}
