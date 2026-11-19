import fs from 'node:fs';
import { NextResponse } from 'next/server';

import { fail, withErrors } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { authenticateStation } from '@/lib/station-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Descarga del archivo CIFRADO para el agente. La clave/IV/authTag se entregan
 * en `print.job` (WS) o en `GET /api/station/jobs/pending` (REST fallback).
 */
export const GET = withErrors(async (req: Request, { params }: { params: { jobId: string } }) => {
  const { stationId } = await authenticateStation(req);
  const job = await prisma.printJob.findFirst({
    where: { id: params.jobId, OR: [{ stationId }, { stationId: null }] },
    include: { order: true },
  });
  if (!job) return fail('JOB_NOT_FOUND', 'Trabajo no encontrado', undefined, 404);
  if (!fs.existsSync(job.order.filePath)) {
    return fail('FILE_NOT_FOUND', 'El archivo cifrado ya no existe', undefined, 404);
  }

  const encrypted = fs.readFileSync(job.order.filePath);
  return new NextResponse(new Uint8Array(encrypted), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(encrypted.length),
      'Content-Disposition': `attachment; filename="${job.order.fileName.replace(/"/g, '')}.enc"`,
      'X-File-Encrypted': 'aes-256-gcm',
      'Cache-Control': 'no-store',
    },
  });
});
