import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeUser } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).max(120).optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['CLIENT', 'EMPLOYEE', 'ADMIN']).optional(),
  free_pages: z.coerce.number().int().min(0).optional(),
  freePages: z.coerce.number().int().min(0).optional(),
});

export const PATCH = withErrors(async (req: Request, { params }: { params: { id: string } }) => {
  const admin = await requireRole(['ADMIN']);
  const body = patchSchema.parse(await req.json());
  const user = await prisma.user.update({
    where: { id: params.id },
    data: {
      ...(body.email ? { email: body.email.toLowerCase() } : {}),
      ...(body.name ? { name: body.name } : {}),
      ...(body.password ? { password: await bcrypt.hash(body.password, 12) } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.free_pages !== undefined || body.freePages !== undefined
        ? { freePages: body.free_pages ?? body.freePages ?? 0 }
        : {}),
    },
  });
  if (user.id === admin.id) console.log('[admin] el administrador actualizó su propio usuario');
  return ok({ user: serializeUser(user) });
});

export const DELETE = withErrors(async (_req: Request, { params }: { params: { id: string } }) => {
  const admin = await requireRole(['ADMIN']);
  if (admin.id === params.id) {
    return fail('CANNOT_DELETE_SELF', 'No puedes eliminar tu propio usuario', undefined, 409);
  }
  await prisma.user.delete({ where: { id: params.id } });
  return new NextResponse(null, { status: 204 });
});
