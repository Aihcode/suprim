import { Footer } from '@/components/Footer';
import { Navbar } from '@/components/Navbar';

import type { ReactNode } from 'react';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-light">
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
