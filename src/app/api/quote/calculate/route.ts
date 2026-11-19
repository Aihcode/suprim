import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { getSessionUser } from '@/lib/auth';
import { calculateQuote } from '@/lib/quote';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const quoteSchema = z.object({
  file_pages: z.number().int().positive().optional(),
  pages: z.number().int().positive().optional(),
  copies: z.number().int().positive().max(100).default(1),
  color: z.boolean().default(false),
  duplex: z.boolean().default(false),
  paper_size: z.string().min(1).max(20).optional(),
  paperSize: z.string().min(1).max(20).optional(),
  user_id: z.string().optional(),
  userId: z.string().optional(),
});

export const POST = withErrors(async (req: Request) => {
  const body = quoteSchema.parse(await req.json());
  const sessionUser = await getSessionUser();
  let userId = body.user_id ?? body.userId;

  // Solo se pueden usar páginas gratis del propio usuario (o con privilegios).
  if (userId && sessionUser && userId !== sessionUser.id && !['ADMIN', 'EMPLOYEE'].includes(sessionUser.role)) {
    userId = sessionUser.id;
  }
  if (!sessionUser) userId = undefined;

  const quote = await calculateQuote({
    file_pages: body.file_pages ?? body.pages ?? 1,
    copies: body.copies,
    color: body.color,
    duplex: body.duplex,
    paper_size: body.paper_size ?? body.paperSize ?? 'A4',
    user_id: userId,
  });

  return ok(quote);
});
