import { z } from 'zod';

import { ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { getDbConfig, updateDbConfig } from '@/lib/db-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  engine: z.enum(['sqlite', 'postgresql', 'mysql', 'sqlserver']),
  database_url: z.string().optional(),
});

export const GET = withErrors(async () => {
  await requireRole(['ADMIN']);
  return ok(getDbConfig());
});

export const PATCH = withErrors(async (req: Request) => {
  await requireRole(['ADMIN']);
  const body = patchSchema.parse(await req.json());
  const config = updateDbConfig(body.engine);
  return ok({
    ...config,
    message:
      'Configuración guardada. Reinicia el servidor tras actualizar DATABASE_URL y el provider de prisma/schema.prisma.',
  });
});
