import { getServerSession, type Session } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';

/** Sesión protegida para páginas del servidor (App Router). */
export async function requireSession(callbackUrl: string): Promise<Session> {
  let session: Session | null = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }
  if (!session) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }
  return session;
}

/** Refuerza RBAC en la capa web; la API vuelve a validar el rol. */
export async function requireRole(
  roles: string[],
  callbackUrl: string,
): Promise<Session> {
  const session = await requireSession(callbackUrl);
  const role = roleOf(session);
  if (role && !roles.includes(role)) redirect('/client');
  return session;
}

export function roleOf(session: Session | null | undefined): string | undefined {
  const user = session?.user as { role?: string } | undefined;
  return user?.role;
}
