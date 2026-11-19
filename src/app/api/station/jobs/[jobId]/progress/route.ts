import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { recordProgress } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { serializeJob } from '@/lib/serialize';
import { authenticateStation } from '@/lib/station-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  status: z.enum([
    'RECEIVED', 'DOWNLOADING', 'PRINTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'LOCAL_QUEUE',
  ]),
  page_current: z.coerce.number().int().min(0).optional(),
  pageCurrent: z.coerce.number().int().min(0).optional(),
  page_total: z.coerce.number().int().min(0).optional(),
  pageTotal: z.coerce.number().int().min(0).optional(),
  message: z.string().max(1000).optional(),
});

export const POST = withErrors(async (req: Request, { params }: { params: { jobId: string } }) => {
  const { stationId } = await authenticateStation(req);
  const body = schema.parse(await req.json());
  const job = await prisma.printJob.findFirst({
    where: { id: params.jobId, OR: [{ stationId }, { stationId: null }] },
  });
  if (!job) return ok({ ok: false, error: 'JOB_NOT_FOUND' }, 404);

  const result = await recordProgress(job.id, {
    status: body.status,
    pageCurrent: body.page_current ?? body.pageCurrent,
    pageTotal: body.page_total ?? body.pageTotal,
    message: body.message,
  });

  return ok({ ok: true, job: serializeJob(result.job), order_status: result.order.status });
});
