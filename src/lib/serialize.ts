import type {
  DiscountRule,
  JobProgress,
  Order,
  Payment,
  PrintJob,
  Printer,
  PrinterStatusLog,
  Station,
  Tariff,
  User,
} from '@prisma/client';

/** Prisma Decimal no es serializable directamente por NextResponse.json. */
export function dec(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number.parseFloat(value) || 0;
  if (typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value) || 0;
}

export function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    free_pages: user.freePages,
    freePages: user.freePages,
    active: true,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

export function serializeStation(station: Station) {
  return {
    id: station.id,
    name: station.name,
    token: station.token,
    station_id: station.id,
    computer_name: station.computerName,
    computerName: station.computerName,
    os: station.os,
    last_seen: station.lastSeen?.toISOString() ?? null,
    lastSeen: station.lastSeen?.toISOString() ?? null,
    active: station.active,
    is_active: station.active,
    created_at: station.createdAt.toISOString(),
  };
}

export function serializePrinter(printer: Printer) {
  return {
    id: printer.id,
    printer_id: printer.id,
    name: printer.name,
    type: printer.type,
    ip: printer.ip,
    port: printer.port,
    protocol: printer.protocol,
    capabilities: parseJson(printer.capabilities, {}),
    status: printer.status,
    station_id: printer.stationId,
    stationId: printer.stationId,
    created_at: printer.createdAt.toISOString(),
  };
}

export function parseJson<T = Record<string, unknown>>(
  value: string | null | undefined,
  fallback: T,
): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

type OrderWithRelations = Order & {
  payments?: Payment[];
  printJobs?: PrintJob[];
};

export function serializeOrder(order: OrderWithRelations) {
  return {
    id: order.id,
    user_id: order.userId,
    userId: order.userId,
    file_name: order.fileName,
    fileName: order.fileName,
    file_path: order.filePath,
    filePath: order.filePath,
    file_key: parseJson(order.fileKey, {}),
    pages: order.pages,
    copies: order.copies,
    color: order.color,
    duplex: order.duplex,
    paper_size: order.paperSize,
    paperSize: order.paperSize,
    base_price: dec(order.basePrice),
    basePrice: dec(order.basePrice),
    total_price: dec(order.totalPrice),
    totalPrice: dec(order.totalPrice),
    discount: dec(order.discount),
    free_pages: order.freePages,
    freePages: order.freePages,
    status: order.status,
    payment_provider: order.paymentProvider,
    paymentProvider: order.paymentProvider,
    payment_id: order.paymentId,
    paymentId: order.paymentId,
    station_id: order.stationId,
    stationId: order.stationId,
    printer_id: order.printerId,
    printerId: order.printerId,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString(),
    ...(order.payments ? { payments: order.payments.map(serializePayment) } : {}),
    ...(order.printJobs ? { jobs: order.printJobs.map(serializeJob) } : {}),
  };
}

export function serializePayment(payment: Payment) {
  return {
    id: payment.id,
    order_id: payment.orderId,
    orderId: payment.orderId,
    provider: payment.provider,
    provider_id: payment.providerId,
    providerId: payment.providerId,
    amount: dec(payment.amount),
    status: payment.status,
    webhook_data: parseJson(payment.webhookData, null),
    created_at: payment.createdAt.toISOString(),
  };
}

export function serializeDiscountRule(rule: DiscountRule) {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    threshold: rule.threshold,
    value: dec(rule.value),
    active: rule.active,
    created_at: rule.createdAt.toISOString(),
  };
}

export function serializeTariff(tariff: Tariff) {
  return {
    id: tariff.id,
    paper_size: tariff.paperSize,
    paperSize: tariff.paperSize,
    color: tariff.color,
    duplex: tariff.duplex,
    price_per_page: dec(tariff.pricePerPage),
    pricePerPage: dec(tariff.pricePerPage),
    active: tariff.active,
    updated_at: tariff.updatedAt.toISOString(),
  };
}

export function serializeJob(job: PrintJob & { progress?: JobProgress[] }) {
  return {
    id: job.id,
    job_id: job.id,
    order_id: job.orderId,
    orderId: job.orderId,
    station_id: job.stationId,
    stationId: job.stationId,
    printer_id: job.printerId,
    printerId: job.printerId,
    status: job.status,
    page_current: job.pageCurrent,
    pageCurrent: job.pageCurrent,
    page_total: job.pageTotal,
    pageTotal: job.pageTotal,
    message: job.message,
    attempts: job.attempts,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    ...(job.progress ? { progress: job.progress.map(serializeProgress) } : {}),
  };
}

export function serializeProgress(progress: JobProgress) {
  return {
    id: progress.id,
    job_id: progress.jobId,
    jobId: progress.jobId,
    status: progress.status,
    page_current: progress.pageCurrent,
    pageCurrent: progress.pageCurrent,
    page_total: progress.pageTotal,
    pageTotal: progress.pageTotal,
    message: progress.message,
    created_at: progress.createdAt.toISOString(),
  };
}

export function serializePrinterLog(log: PrinterStatusLog) {
  return {
    id: log.id,
    printer_id: log.printerId,
    printerId: log.printerId,
    status: log.status,
    message: log.message,
    recorded_at: log.recordedAt.toISOString(),
    timestamp: log.recordedAt.toISOString(),
  };
}
