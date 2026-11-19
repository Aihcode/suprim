'use client';

import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { captureException, identifyUser, initLogRocket, trackEvent } from '@/lib/logrocket';

/**
 * Inicializa LogRocket, asocia la identidad de NextAuth y registra errores y
 * navegación. No renderiza nada y es inactivo sin NEXT_PUBLIC_LOGROCKET_APP_ID.
 */
export function LogRocketBootstrap() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void initLogRocket().then((enabled) => {
      if (enabled) trackEvent('app_initialized', { surface: 'web' });
    });
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user) return;
    const user = session.user as unknown as Record<string, unknown>;
    const id = String(user.id ?? user.email ?? '');
    if (!id) return;
    identifyUser(id, {
      email: user.email,
      name: user.name,
      role: user.role ?? 'CLIENT',
    });
  }, [session, status]);

  useEffect(() => {
    if (pathname) trackEvent('page_view', { path: pathname });
  }, [pathname]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => captureException(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => captureException(event.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
