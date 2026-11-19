import { ok, withErrors } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { getIO } from '@/lib/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withErrors(async () => {
  let database = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    database = 'error';
    console.error('[health] BD no disponible:', error);
  }

  const url = process.env.DATABASE_URL || 'file:./dev.db';
  const engine = url.startsWith('postgres')
    ? 'postgresql'
    : url.startsWith('mysql')
      ? 'mysql'
      : url.startsWith('sqlserver')
        ? 'sqlserver'
        : 'sqlite';

  return ok({
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    engine,
    websocket: Boolean(getIO()),
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
  });
});
