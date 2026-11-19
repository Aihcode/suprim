import { fail, ok, withErrors } from '@/lib/api';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Progreso público de seguimiento: solo estados y avance de impresión.
 * Deliberadamente NO expone rutas de archivo, claves de cifrado, pagos ni datos
 * del cliente; el detalle completo sigue protegido en GET /api/client/orders/:id.
 */
export const GET = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { printJobs: { include: { progress: { orderBy: { createdAt: 'asc' } } } } },
  });
  if (!order) return fail('ORDER_NOT_FOUND', 'Orden no encontrada', undefined, 404);

  const progress = order.printJobs.flatMap((job) => job.progress).map((event) => ({
    job_id: event.jobId,
    status: event.status,
    page_current: event.pageCurrent,
    page_total: event.pageTotal,
    message: event.message,
    created_at: event.createdAt.toISOString(),
  }));
  const latest = order.printJobs.at(-1);

  return ok({
    order_id: order.id,
    status: order.status,
    order_status: order.status,
    job_id: latest?.id ?? null,
    page_current: latest?.pageCurrent ?? 0,
    page_total: latest?.pageTotal ?? order.pages * order.copies,
    message: latest?.message ?? null,
    payment_status: order.status === 'PAID' || order.status === 'PROCESSING' ||
      order.status === 'COMPLETED' ? 'PAID' : 'PENDING',
    progress,
    updated_at: order.updatedAt.toISOString(),
  });
});
