import { fail, ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { createPrintJob, dispatchJob, getPendingJobs } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { serializeJob } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['EMPLOYEE']);
  const body = (await req.json().catch(() => ({}))) as { station_id?: string; printer_id?: string };
  const order = await prisma.order.findUnique({ where: { id: params.id } });
  if (!order) return fail('ORDER_NOT_FOUND', 'Orden no encontrada', undefined, 404);
  if (order.status !== 'PAID' && order.status !== 'PROCESSING') {
    return fail('ORDER_NOT_RELEASABLE', 'La orden debe estar pagada para liberarla', undefined, 409);
  }

  const stationId = body.station_id ?? order.stationId ?? (await prisma.station.findFirst({ where: { active: true } }))?.id ?? null;
  if (!stationId) return fail('NO_STATION', 'No hay estaciones activas', undefined, 409);

  const pending = await getPendingJobs(stationId);
  let job = pending.find((item) => item.orderId === order.id);
  if (!job) {
    job = await createPrintJob({
      orderId: order.id,
      stationId,
      printerId: body.printer_id ?? order.printerId,
      pageTotal: order.pages * order.copies,
    });
  }

  if (order.status !== 'PROCESSING') {
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PROCESSING', stationId } });
  }
  const dispatch = await dispatchJob(job.id);

  return ok({ job: serializeJob(job), emitted: dispatch.emitted });
});
