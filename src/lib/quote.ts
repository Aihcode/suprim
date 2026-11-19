import { prisma } from '@/lib/prisma';
import { dec } from '@/lib/serialize';

/**
 * Motor de cotización: tarifas activas + reglas de descuento activas + saldo de
 * páginas gratis del usuario. Devuelve importes redondeados a 2 decimales.
 */

export interface QuoteInput {
  file_pages?: number;
  pages?: number;
  copies?: number;
  color?: boolean;
  duplex?: boolean;
  paper_size?: string;
  paperSize?: string;
  user_id?: string;
  userId?: string;
}

export interface QuoteDiscountDetail {
  name: string;
  type: string;
  threshold: number | null;
  value: number;
  amount: number;
}

export interface QuoteResult {
  base_price: number;
  discount: number;
  free_pages: number;
  total_price: number;
  breakdown: {
    pages: number;
    copies: number;
    total_pages: number;
    paper_size: string;
    color: boolean;
    duplex: boolean;
    price_per_page: number;
    base_price: number;
    user_free_pages: number;
    earned_free_pages: number;
    free_pages_available: number;
    free_pages_used: number;
    billable_pages: number;
    discount_details: QuoteDiscountDetail[];
    discount: number;
    total_price: number;
    savings: number;
  };
  // Alias camelCase para consumidores que usan el modelo Prisma directamente.
  basePrice: number;
  totalPrice: number;
  freePages: number;
}

const DEFAULT_PRICES: Record<string, number> = { A4: 0.08, LETTER: 0.09 };

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function calculateQuote(input: QuoteInput): Promise<QuoteResult> {
  const pages = Math.max(1, Math.floor(Number(input.file_pages ?? input.pages ?? 1)));
  const copies = Math.max(1, Math.floor(Number(input.copies ?? 1)));
  const color = Boolean(input.color ?? false);
  const duplex = Boolean(input.duplex ?? false);
  const paperSize = String(input.paper_size ?? input.paperSize ?? 'A4').toUpperCase();
  const userId = input.user_id ?? input.userId;
  const totalPages = pages * copies;

  const [tariffs, rules, user] = await Promise.all([
    prisma.tariff.findMany({ where: { active: true } }),
    prisma.discountRule.findMany({ where: { active: true }, orderBy: { threshold: 'asc' } }),
    userId
      ? prisma.user.findUnique({ where: { id: userId }, select: { freePages: true } })
      : Promise.resolve(null),
  ]);

  const tariff =
    tariffs.find((t) => t.paperSize.toUpperCase() === paperSize && t.color === color && t.duplex === duplex) ??
    tariffs.find((t) => t.paperSize.toUpperCase() === 'A4' && t.color === color && t.duplex === duplex) ??
    tariffs.find((t) => t.color === color && t.duplex === duplex);

  const pricePerPage = tariff
    ? dec(tariff.pricePerPage)
    : (color ? 0.18 : 0.08) * (duplex ? 1.5 : 1) * (DEFAULT_PRICES[paperSize] ? DEFAULT_PRICES[paperSize] / DEFAULT_PRICES.A4 : 1);

  const basePrice = round2(totalPages * pricePerPage);
  const userFreePages = user?.freePages ?? 0;

  let earnedFreePages = 0;
  for (const rule of rules) {
    if (rule.type !== 'FREE_PAGES') continue;
    if (rule.threshold !== null && rule.threshold !== undefined && pages < rule.threshold) continue;
    earnedFreePages += Math.max(0, Math.floor(Number(rule.value)));
  }

  const freePagesAvailable = userFreePages + earnedFreePages;
  const freePagesUsed = Math.min(freePagesAvailable, totalPages);
  const billablePages = Math.max(0, totalPages - freePagesUsed);
  const priceAfterFree = billablePages * pricePerPage;

  const discountDetails: QuoteDiscountDetail[] = [];
  for (const rule of rules) {
    if (rule.type === 'FREE_PAGES') continue;
    if (rule.threshold !== null && rule.threshold !== undefined && pages < rule.threshold) continue;
    const value = Number(rule.value);
    const amount =
      rule.type === 'PERCENTAGE'
        ? (priceAfterFree * value) / 100
        : Math.min(priceAfterFree, value);
    if (amount <= 0) continue;
    discountDetails.push({
      name: rule.name,
      type: rule.type,
      threshold: rule.threshold ?? null,
      value,
      amount: round2(amount),
    });
  }

  const rawDiscount = discountDetails.reduce((sum, d) => sum + d.amount, 0);
  const discount = round2(Math.min(rawDiscount, priceAfterFree));
  const totalPrice = round2(Math.max(0, priceAfterFree - discount));

  return {
    base_price: basePrice,
    discount,
    free_pages: freePagesUsed,
    total_price: totalPrice,
    breakdown: {
      pages,
      copies,
      total_pages: totalPages,
      paper_size: paperSize,
      color,
      duplex,
      price_per_page: round2(pricePerPage * 1000) / 1000,
      base_price: basePrice,
      user_free_pages: userFreePages,
      earned_free_pages: earnedFreePages,
      free_pages_available: freePagesAvailable,
      free_pages_used: freePagesUsed,
      billable_pages: billablePages,
      discount_details: discountDetails,
      discount,
      total_price: totalPrice,
      savings: round2(basePrice - totalPrice),
    },
    basePrice,
    totalPrice,
    freePages: freePagesUsed,
  };
}
