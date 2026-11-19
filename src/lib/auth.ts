import { getServerSession, type DefaultSession, type NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';

import { HttpError } from '@/lib/api';
import { prisma } from '@/lib/prisma';

export type Role = 'CLIENT' | 'EMPLOYEE' | 'ADMIN';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  freePages: number;
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: string;
      freePages: number;
    } & DefaultSession['user'];
  }
  interface User {
    role?: string | null;
    freePages?: number | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: string;
    freePages?: number;
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET || process.env.JWT_SECRET || 'dev-nextauth-secret',
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = String(credentials.email).trim().toLowerCase();
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const valid = await bcrypt.compare(String(credentials.password), user.password);
        if (!valid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          freePages: user.freePages,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? 'CLIENT';
        token.freePages = user.freePages ?? 0;
      }
      // Refrescar el saldo de páginas gratis cuando se pide una nueva sesión.
      if (trigger === 'update' && token.id) {
        const fresh = await prisma.user.findUnique({ where: { id: token.id } });
        if (fresh) {
          token.freePages = fresh.freePages;
          token.role = fresh.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? '';
        session.user.role = token.role ?? 'CLIENT';
        session.user.freePages = token.freePages ?? 0;
      }
      return session;
    },
  },
};

/** Usuario autenticado de la sesión actual, o null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? '',
    name: session.user.name ?? '',
    role: session.user.role ?? 'CLIENT',
    freePages: session.user.freePages ?? 0,
  };
}

/** Exige sesión válida; lanza HttpError(401) si no hay usuario. */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Se requiere autenticación');
  return user;
}

/**
 * Exige sesión válida Y uno de los roles indicados.
 * ADMIN tiene acceso implícito a todas las rutas de EMPLOYEE.
 */
export async function requireRole(roles: string[]): Promise<SessionUser> {
  const user = await requireAuth();
  const allowed = user.role === 'ADMIN' || roles.includes(user.role);
  if (!allowed) {
    throw new HttpError(
      403,
      'FORBIDDEN',
      'No tienes permisos para realizar esta acción',
      { required: roles, current: user.role },
    );
  }
  return user;
}

/** Verifica pertenencia de un recurso al usuario (o que sea Staff). */
export function assertOwnerOrStaff(user: SessionUser, ownerId: string): void {
  if (ownerId === user.id) return;
  if (user.role === 'EMPLOYEE' || user.role === 'ADMIN') return;
  throw new HttpError(403, 'FORBIDDEN', 'No puedes acceder a este recurso');
}
