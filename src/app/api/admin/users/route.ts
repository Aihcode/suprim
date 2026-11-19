import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeUser } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).max(120),
  role: z.enum(['CLIENT', 'EMPLOYEE', 'ADMIN']).default('CLIENT'),
  free_pages: z.coerce.number().int().min(0).optional(),
  freePages: z.coerce.number().int().min(0).optional(),
});

export const GET = withErrors(async (req: Request) => {
  await requireRole(['ADMIN']);
  const url = new URL(req.url);
  const role = url.searchParams.get('role') ?? undefined;
  const users = await prisma.user.findMany({
    where: role ? { role } : undefined,
    orderBy: { createdAt: 'desc' },
  });
  return ok({ users: users.map(serializeUser) });
});

export const POST = withErrors(async (req: Request) => {
  await requireRole(['ADMIN']);
  const body = createSchema.parse(await req.json());
  const email = body.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    return fail('EMAIL_EXISTS', 'Ya existe un usuario con ese email', undefined, 409);
  }
  const user = await prisma.user.create({
    data: {
      email,
      name: body.name,
      password: await bcrypt.hash(body.password, 12),
      role: body.role,
      freePages: body.free_pages ?? body.freePages ?? 0,
    },
  });
  return ok({ user: serializeUser(user) }, 201);
});
