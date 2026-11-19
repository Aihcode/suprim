import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { fail, ok, withErrors } from '@/lib/api';
import { prisma } from '@/lib/prisma';
import { serializeUser } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  name: z.string().min(1).max(120),
});

export const POST = withErrors(async (req: Request) => {
  const body = registerSchema.parse(await req.json());
  const email = body.email.trim().toLowerCase();

  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return fail('EMAIL_EXISTS', 'Ya existe un usuario con ese email', undefined, 409);

  const user = await prisma.user.create({
    data: {
      email,
      name: body.name.trim(),
      password: await bcrypt.hash(body.password, 12),
      role: 'CLIENT',
      freePages: 0,
    },
  });

  return ok({ user: serializeUser(user) }, 201);
});
