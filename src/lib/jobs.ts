import type { Order, PrintJob } from '@prisma/client';

import { HttpError } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { emitToAll, emitToRoom, emitToStation } from '@/lib/realtime';
import { parseJson, serializeJob } from '@/lib/serialize';

export const ACTIVE_JOB_STATUSES = [
  'PENDING',
  'RECEIVED',
  'DOWNLOADING',
  'PRINTING',
  'LOCAL_QUEUE',
];

export interface CreateJobInput {
  orderId: string;
  stationId?: string | null;
  printerId?: string | null;
  pageTotal: number;
  attempts?: number;
}

export interface ProgressInput {
  status: string;
  pageCurrent?: number;
  pageTotal?: number;
  message?: string;
}

export async function createPrintJob(input: CreateJobInput): Promise<PrintJob> {
  return prisma.printJob.create({
    data: {
      orderId: input.orderId,
      stationId: input.stationId ?? null,
      printerId: input.printerId ?? null,
      pageTotal: Math.max(1, Math.floor(input.pageTotal)),
      attempts: input.attempts ?? 0,
      status: 'PENDING',
    },
  });
}

/** Actualiza un trabajo y deja constancia en el historial JobProgress. */
export async function updatePrintJob(jobId: string, input: ProgressInput): Promise<PrintJob> {
  const job = await prisma.printJob.findUnique({ where: { id: jobId } });
  if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Trabajo no encontrado');

  const updated = await prisma.printJob.update({
    where: { id: jobId },
    data: {
      status: input.status,
      ...(input.pageCurrent !== undefined ? { pageCurrent: Math.max(0, Math.floor(input.pageCurrent)) } : {}),
      ...(input.pageTotal !== undefined ? { pageTotal: Math.max(0, Math.floor(input.pageTotal)) } : {}),
      ...(input.message !== undefined ? { message: input.message } : {}),
    },
  });

  await prisma.jobProgress.create({
    data: {
      jobId,
      status: input.status,
      pageCurrent: updated.pageCurrent,
      pageTotal: updated.pageTotal,
      message: updated.message,
    },
  });

  return updated;
}

const ORDER_STATUS_BY_JOB: Record<string, string> = {
  RECEIVED: 'PROCESSING',
  DOWNLOADING: 'PROCESSING',
  PRINTING: 'PROCESSING',
  LOCAL_QUEUE: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

/**
 * Registra progreso, sincroniza el estado de la Order y hace rebroadcast a los
 * paneles de administración y clientes (rooms `/admin` y `/client`).
 */
export async function recordProgress(jobId: string, input: ProgressInput) {
  const before = await prisma.printJob.findUnique({
    where: { id: jobId },
    include: { order: true },
  });
  if (!before) throw new HttpError(404, 'JOB_NOT_FOUND', 'Trabajo no encontrado');

  const job = await updatePrintJob(jobId, input);
  const orderStatus = ORDER_STATUS_BY_JOB[input.status.toUpperCase()];
  let order = before.order;
  if (orderStatus && order.status !== orderStatus && order.status !== 'CANCELLED') {
    order = await prisma.order.update({
      where: { id: before.orderId },
      data: { status: orderStatus },
    });
  }

  const payload = {
    type: 'order.progress',
    job_id: job.id,
    order_id: order.id,
    status: job.status,
    order_status: order.status,
    page_current: job.pageCurrent,
    page_total: job.pageTotal,
    message: job.message,
    timestamp: new Date().toISOString(),
  };

  emitToAll('order.progress', payload);
  emitToAll('job.progress', payload);
  emitToRoom('admin:all', 'order.progress', payload);
  emitToRoom(`order:${order.id}`, 'order.progress', payload);
  emitToRoom(`user:${order.userId}`, 'order.progress', payload);
  if (job.stationId) emitToStation(job.stationId, 'job.progress.ack', payload);

  return { job, order, payload };
}

/** Trabajos disponibles para una estación (WS + fallback REST). */
export async function getPendingJobs(stationId?: string | null): Promise<PrintJob[]> {
  return prisma.printJob.findMany({
    where: {
      status: { in: ACTIVE_JOB_STATUSES },
      ...(stationId ? { OR: [{ stationId }, { stationId: null }] } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Emite `print.job` al room de la estación. El trabajo también queda persistido
 * para que el agente pueda recuperarlo por polling REST si el WS no está activo.
 */
export async function dispatchJob(jobOrId: PrintJob | string) {
  const jobId = typeof jobOrId === 'string' ? jobOrId : jobOrId.id;
  const job = await prisma.printJob.findUnique({
    where: { id: jobId },
    include: { order: true },
  });
  if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Trabajo no encontrado');

  const order: Order = job.order;
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'Orden no encontrada');

  const printer = job.printerId
    ? await prisma.printer.findUnique({ where: { id: job.printerId }, select: { name: true } })
    : null;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const fileKey = parseJson<{ key?: string; iv?: string; authTag?: string }>(order.fileKey, {});

  const payload = {
    type: 'print.job',
    job_id: job.id,
    order_id: order.id,
    station_id: job.stationId,
    file_url: `${baseUrl}/api/station/jobs/${job.id}/file`,
    file_encrypted: true,
    file_checksum: null,
    file_name: order.fileName,
    parameters: {
      copies: order.copies,
      color: order.color,
      duplex: order.duplex,
      paper_size: order.paperSize,
      page_range: `1-${order.pages}`,
      tray: 'default',
    },
    printer_id: job.printerId,
    printer_name: printer?.name ?? null,
    encryption_key_b64: fileKey.key
      ? Buffer.from(fileKey.key, 'hex').toString('base64')
      : undefined,
    iv_b64: fileKey.iv ? Buffer.from(fileKey.iv, 'hex').toString('base64') : undefined,
    auth_tag_b64: fileKey.authTag
      ? Buffer.from(fileKey.authTag, 'hex').toString('base64')
      : undefined,
  };

  if (job.stationId) emitToStation(job.stationId, 'print.job', payload);
  emitToRoom('admin:all', 'print.job', payload);

  return { job, payload, emitted: Boolean(job.stationId) };
}

/** Detalle serializado de un trabajo, para las respuestas REST. */
export function jobResponse(job: PrintJob) {
  return serializeJob(job);
}
