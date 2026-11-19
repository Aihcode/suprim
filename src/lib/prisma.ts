import { PrismaClient } from '@prisma/client';

/**
 * Singleton de PrismaClient con soporte para hot-reload de Next.js.
 * En desarrollo el módulo se reevalúa en cada cambio: guardamos la instancia en
 * `globalThis` para no agotar el pool de conexiones.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
