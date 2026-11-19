import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { recordProgress } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { authenticateStation } from '@/lib/station-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const jobSchema = z.object({
  job_id: z.string().min(1),
  status: z.string().min(1),
  page_current: z.coerce.number().int().min(0).optional(),
  page_total: z.coerce.number().int().min(0).optional(),
  message: z.string().max(1000).optional(),
});

const syncSchema = z.object({ jobs: z.array(jobSchema).max(500) });

/** Sincronización del modo contingencia tras recuperar conexión. */
export const POST = withErrors(async (req: Request) => {
  const { stationId } = await authenticateStation(req);
  const body = syncSchema.parse(await req.json());
  const results: { job_id: string; ok: boolean; error?: string }[] = [];

  for (const item of body.jobs) {
    try {
      const job = await prisma.printJob.findFirst({
        where: { id: item.job_id, OR: [{ stationId }, { stationId: null }] },
      });
      if (!job) {
        results.push({ job_id: item.job_id, ok: false, error: 'JOB_NOT_FOUND' });
        continue;
      }
      await recordProgress(job.id, {
        status: item.status.toUpperCase(),
        pageCurrent: item.page_current,
        pageTotal: item.page_total,
        message: item.message,
      });
      results.push({ job_id: item.job_id, ok: true });
    } catch (error) {
      results.push({
        job_id: item.job_id,
        ok: false,
        error: error instanceof Error ? error.message : 'ERROR',
      });
    }
  }

  return ok({
    station_id: stationId,
    received: body.jobs.length,
    processed: results.filter((item) => item.ok).length,
    results,
  });
});
