import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  await requireRole(['ADMIN']);
  const [grouped, printers, logs] = await Promise.all([
    prisma.printJob.groupBy({
      by: ['printerId'],
      _count: { _all: true },
      _sum: { pageTotal: true, pageCurrent: true },
    }),
    prisma.printer.findMany({ include: { station: { select: { id: true, name: true } } } }),
    prisma.printerStatusLog.count(),
  ]);

  const byId = new Map(printers.map((printer) => [printer.id, printer]));
  const usage = grouped
    .filter((item) => item.printerId)
    .map((item) => {
      const printer = byId.get(item.printerId as string);
      return {
        printer_id: item.printerId,
        printerId: item.printerId,
        name: printer?.name ?? 'Desconocida',
        station: printer?.station?.name ?? null,
        status: printer?.status ?? null,
        jobs: item._count._all,
        pages: item._sum.pageTotal ?? 0,
        pages_printed: item._sum.pageCurrent ?? 0,
      };
    })
    .sort((a, b) => b.jobs - a.jobs);

  return ok({ usage, printers: printers.length, status_logs: logs, total_jobs: usage.reduce((sum, u) => sum + u.jobs, 0) });
});
