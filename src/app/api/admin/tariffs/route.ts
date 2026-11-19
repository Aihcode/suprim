import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeTariff } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tariffSchema = z.object({
  paper_size: z.string().min(1).max(20).optional(),
  paperSize: z.string().min(1).max(20).optional(),
  color: z.boolean().default(false),
  duplex: z.boolean().default(false),
  price_per_page: z.coerce.number().min(0).optional(),
  pricePerPage: z.coerce.number().min(0).optional(),
  active: z.boolean().default(true),
});

export const GET = withErrors(async () => {
  await requireRole(['ADMIN']);
  const tariffs = await prisma.tariff.findMany({ orderBy: [{ paperSize: 'asc' }, { color: 'asc' }, { duplex: 'asc' }] });
  return ok({ tariffs: tariffs.map(serializeTariff) });
});

export const POST = withErrors(async (req: Request) => {
  await requireRole(['ADMIN']);
  const body = tariffSchema.parse(await req.json());
  const paperSize = (body.paper_size ?? body.paperSize ?? 'A4').toUpperCase();
  const price = body.price_per_page ?? body.pricePerPage;
  if (price === undefined) return fail('PRICE_REQUIRED', 'Se requiere price_per_page');

  const tariff = await prisma.tariff.upsert({
    where: { paperSize_color_duplex: { paperSize, color: body.color, duplex: body.duplex } },
    create: { paperSize, color: body.color, duplex: body.duplex, pricePerPage: price, active: body.active },
    update: { pricePerPage: price, active: body.active },
  });
  return ok({ tariff: serializeTariff(tariff) }, 201);
});
