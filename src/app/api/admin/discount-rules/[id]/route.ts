import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeDiscountRule } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  type: z.enum(['PERCENTAGE', 'FIXED', 'FREE_PAGES']).optional(),
  threshold: z.coerce.number().int().positive().nullable().optional(),
  value: z.coerce.number().min(0).optional(),
  active: z.boolean().optional(),
});

export const PATCH = withErrors(async (req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['ADMIN']);
  const body = patchSchema.parse(await req.json());
  const rule = await prisma.discountRule.update({
    where: { id: params.id },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.type ? { type: body.type } : {}),
      ...(body.threshold !== undefined ? { threshold: body.threshold } : {}),
      ...(body.value !== undefined ? { value: body.value } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
  });
  return ok({ discount_rule: serializeDiscountRule(rule) });
});

export const DELETE = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['ADMIN']);
  await prisma.discountRule.delete({ where: { id: params.id } });
  return ok({ deleted: true });
});
