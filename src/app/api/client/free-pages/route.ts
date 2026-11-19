import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  const user = await requireRole(['CLIENT']);
  const history = await prisma.order.findMany({
    where: { userId: user.id, freePages: { gt: 0 } },
    select: { id: true, fileName: true, freePages: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return ok({
    user_id: user.id,
    free_pages: user.freePages,
    freePages: user.freePages,
    balance: user.freePages,
    total: user.freePages,
    used: 0,
    history: history.map((item) => ({
      order_id: item.id,
      file_name: item.fileName,
      free_pages: item.freePages,
      status: item.status,
      created_at: item.createdAt.toISOString(),
    })),
  });
});
