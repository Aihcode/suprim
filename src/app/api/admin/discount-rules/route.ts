import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeDiscountRule } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['PERCENTAGE', 'FIXED', 'FREE_PAGES']),
  threshold: z.coerce.number().int().positive().nullable().optional(),
  value: z.coerce.number().min(0),
  active: z.boolean().default(true),
});

export const GET = withErrors(async () => {
  await requireRole(['ADMIN']);
  const rules = await prisma.discountRule.findMany({ orderBy: [{ active: 'desc' }, { threshold: 'asc' }] });
  return ok({ discount_rules: rules.map(serializeDiscountRule), rules: rules.map(serializeDiscountRule) });
});

export const POST = withErrors(async (req: Request) => {
  await requireRole(['ADMIN']);
  const body = createSchema.parse(await req.json());
  const rule = await prisma.discountRule.create({
    data: {
      name: body.name,
      type: body.type,
      threshold: body.threshold ?? null,
      value: body.value,
      active: body.active,
    },
  });
  return ok({ discount_rule: serializeDiscountRule(rule) }, 201);
});
