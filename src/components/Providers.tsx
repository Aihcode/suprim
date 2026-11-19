'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';
import { LogRocketBootstrap } from '@/components/LogRocketBootstrap';
import { ToastProvider } from '@/components/ToastProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <LogRocketBootstrap />
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
