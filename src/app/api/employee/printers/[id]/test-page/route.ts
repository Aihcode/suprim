import { fail, ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { emitToStation } from '@/lib/realtime';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  await requireRole(['EMPLOYEE']);
  const printer = await prisma.printer.findUnique({ where: { id: params.id } });
  if (!printer) return fail('PRINTER_NOT_FOUND', 'Impresora no encontrada', undefined, 404);
  if (!printer.stationId) {
    return fail('STATION_NOT_ASSIGNED', 'La impresora no tiene una estación asignada', undefined, 409);
  }

  const payload = {
    type: 'print.control',
    action: 'test_page',
    printer_id: printer.id,
    printerId: printer.id,
    station_id: printer.stationId,
  };
  const emitted = emitToStation(printer.stationId, 'print.control', payload);
  return ok({ sent: emitted, ...payload });
});
