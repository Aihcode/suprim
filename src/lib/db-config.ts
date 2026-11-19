import fs from 'node:fs';
import path from 'node:path';

/**
 * Configuración operativa del motor de BD. El archivo `.db-config.json` es
 * documentación del motor seleccionado desde el panel admin. El cambio real
 * requiere editar `prisma/schema.prisma` (provider) + `.env` (DATABASE_URL) y
 * reiniciar: Prisma no admite cambiar el provider en caliente.
 */

export type DbEngine = 'sqlite' | 'postgresql' | 'mysql' | 'sqlserver';

export interface DbConfig {
  engine: DbEngine;
  databaseUrlConfigured: boolean;
  requiresRestart: boolean;
  updatedAt?: string;
  note: string;
}

const CONFIG_PATH = path.resolve(process.cwd(), '.db-config.json');

const NOTE =
  'Para aplicar el cambio: actualiza DATABASE_URL en .env y el provider en prisma/schema.prisma, ejecuta `npx prisma generate && npx prisma db push` y reinicia el servidor.';

function detectEngine(): DbEngine {
  const url = process.env.DATABASE_URL || 'file:./dev.db';
  if (url.startsWith('postgres')) return 'postgresql';
  if (url.startsWith('mysql')) return 'mysql';
  if (url.startsWith('sqlserver')) return 'sqlserver';
  return 'sqlite';
}

export function getDbConfig(): DbConfig {
  let saved: { engine?: string; updatedAt?: string } = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as typeof saved;
    }
  } catch {
    /* archivo corrupto: se ignora */
  }
  const validEngines: DbEngine[] = ['sqlite', 'postgresql', 'mysql', 'sqlserver'];
  return {
    engine: validEngines.includes(saved.engine as DbEngine)
      ? (saved.engine as DbEngine)
      : detectEngine(),
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
    requiresRestart: false,
    ...(saved.updatedAt ? { updatedAt: saved.updatedAt } : {}),
    note: NOTE,
  };
}

export function updateDbConfig(engine: DbEngine): DbConfig {
  const payload = { engine, updatedAt: new Date().toISOString(), note: NOTE };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { ...getDbConfig(), ...payload, requiresRestart: true };
}
