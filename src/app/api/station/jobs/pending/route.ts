import { ok, withErrors } from '@/lib/api';
import { getPendingJobs } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { parseJson, serializeJob } from '@/lib/serialize';
import { authenticateStation } from '@/lib/station-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async (req: Request) => {
  const { stationId } = await authenticateStation(req);
  const jobs = await getPendingJobs(stationId);
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  const enriched = await Promise.all(
    jobs.map(async (job) => {
      const [order, printer] = await Promise.all([
        prisma.order.findUnique({ where: { id: job.orderId } }),
        job.printerId
          ? prisma.printer.findUnique({ where: { id: job.printerId }, select: { name: true } })
          : Promise.resolve(null),
      ]);
      const key = order ? parseJson<{ key?: string; iv?: string; authTag?: string }>(order.fileKey, {}) : {};
      const b64 = (hex?: string) => (hex ? Buffer.from(hex, 'hex').toString('base64') : undefined);
      return {
        ...serializeJob(job),
        order_id: job.orderId,
        file_name: order?.fileName ?? null,
        file_url: `${baseUrl}/api/station/jobs/${job.id}/file`,
        file_encrypted: true,
        file_checksum: null,
        // Mismas claves que el evento WS `print.job` para que el agente pueda
        // descifrar también cuando trabaja por polling REST.
        encryption: key,
        encryption_key_b64: b64(key.key),
        iv_b64: b64(key.iv),
        auth_tag_b64: b64(key.authTag),
        printer_name: printer?.name ?? null,
        parameters: order
          ? {
              copies: order.copies,
              color: order.color,
              duplex: order.duplex,
              paper_size: order.paperSize,
              page_range: `1-${order.pages}`,
              tray: 'default',
            }
          : null,
      };
    }),
  );

  return ok({ jobs: enriched, count: enriched.length, station_id: stationId });
});
