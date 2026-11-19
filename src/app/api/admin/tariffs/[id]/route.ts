import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeTariff } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  paper_size: z.string().min(1).max(20).optional(),
  paperSize: z.string().min(1).max(20).optional(),
  color: z.boolean().optional(),
  duplex: z.boolean().optional(),
  price_per_page: z.coerce.number().min(0).optional(),
  pricePerPage: z.coerce.number().min(0).optional(),
  active: z.boolean().optional(),
});

export const PATCH = withErrors(async (req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['ADMIN']);
  const body = patchSchema.parse(await req.json());
  const tariff = await prisma.tariff.update({
    where: { id: params.id },
    data: {
      ...(body.paper_size || body.paperSize ? { paperSize: (body.paper_size ?? body.paperSize ?? '').toUpperCase() } : {}),
      ...(body.color !== undefined ? { color: body.color } : {}),
      ...(body.duplex !== undefined ? { duplex: body.duplex } : {}),
      ...(body.price_per_page !== undefined || body.pricePerPage !== undefined
        ? { pricePerPage: body.price_per_page ?? body.pricePerPage ?? 0 }
        : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    },
  });
  return ok({ tariff: serializeTariff(tariff) });
});

export const DELETE = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['ADMIN']);
  await prisma.tariff.delete({ where: { id: params.id } });
  return ok({ deleted: true });
});
