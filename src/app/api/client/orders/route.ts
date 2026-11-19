import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { saveEncryptedFile } from '@/lib/encryption';
import { prisma } from '@/lib/prisma';
import { calculateQuote } from '@/lib/quote';
import { serializeOrder } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const listSchema = z.object({
  status: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const uploadSchema = z.object({
  copies: z.coerce.number().int().positive().max(100).default(1),
  color: z.coerce.boolean().default(false),
  duplex: z.coerce.boolean().default(false),
  paper_size: z.string().min(1).max(20).default('A4'),
  pages: z.coerce.number().int().positive().max(100000).optional(),
  station_id: z.string().optional(),
  printer_id: z.string().optional(),
});

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Cuenta objetos /Type /Page (excluyendo /Pages) en un PDF. */
function detectPdfPages(buffer: Buffer): number {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  return matches && matches.length > 0 ? matches.length : 1;
}

function parseBool(value: FormDataEntryValue | null): boolean {
  if (value === null) return false;
  const raw = String(value).toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes';
}

export const GET = withErrors(async (req: Request) => {
  const user = await requireAuth();
  const url = new URL(req.url);
  const { status, page, limit } = listSchema.parse({
    status: url.searchParams.get('status') ?? undefined,
    page: url.searchParams.get('page') ?? 1,
    limit: url.searchParams.get('limit') ?? 20,
  });

  const where = {
    userId: user.id,
    ...(status ? { status } : {}),
  };
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: { payments: true, printJobs: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return ok({ orders: orders.map(serializeOrder), total, page, limit });
});

export const POST = withErrors(async (req: Request) => {
  const user = await requireAuth();
  const form = await req.formData();
  const rawFile = form.get('file');
  // Duck-typing: `File` no es global en todas las versiones de Node 18.
  if (!rawFile || typeof rawFile === 'string' || typeof (rawFile as File).arrayBuffer !== 'function') {
    return fail('FILE_REQUIRED', 'Se requiere un archivo en el campo "file"');
  }
  const file = rawFile as File;
  if (file.size > MAX_FILE_BYTES) {
    return fail('FILE_TOO_LARGE', 'El archivo supera el límite de 20 MB');
  }

  const body = uploadSchema.parse({
    copies: form.get('copies') ?? 1,
    color: parseBool(form.get('color')),
    duplex: parseBool(form.get('duplex')),
    paper_size: form.get('paper_size') ?? form.get('paperSize') ?? 'A4',
    pages: form.get('pages') ?? undefined,
    station_id: form.get('station_id') ?? undefined,
    printer_id: form.get('printer_id') ?? undefined,
  });

  const buffer = Buffer.from(await file.arrayBuffer());
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  // Se detecta por regex en el PDF; el formulario puede override el valor detectado.
  const detectedPages = isPdf ? detectPdfPages(buffer) : 1;
  const pages = body.pages ?? detectedPages;

  const quote = await calculateQuote({
    file_pages: pages,
    copies: body.copies,
    color: body.color,
    duplex: body.duplex,
    paper_size: body.paper_size,
    user_id: user.id,
  });

  // El archivo se cifra SIEMPRE antes de tocar disco.
  const stored = saveEncryptedFile(buffer, file.name);

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      fileName: file.name,
      filePath: stored.filePath,
      fileKey: stored.fileKey,
      pages,
      copies: body.copies,
      color: body.color,
      duplex: body.duplex,
      paperSize: body.paper_size.toUpperCase(),
      basePrice: quote.base_price,
      totalPrice: quote.total_price,
      discount: quote.discount,
      freePages: quote.free_pages,
      status: 'PENDING',
      stationId: body.station_id ?? null,
      printerId: body.printer_id ?? null,
    },
    include: { payments: true, printJobs: true },
  });

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return ok(
    {
      order: serializeOrder(order),
      payment_url: `${baseUrl}/api/client/orders/${order.id}/pay`,
      quote,
      file_checksum: stored.checksum,
    },
    201,
  );
});
