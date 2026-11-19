import type { Metadata } from 'next';
import { ClientPortal } from '@/components/ClientPortal';
import { PublicLayout } from '@/components/PublicLayout';
import { requireSession } from '@/components/server-auth';

export const metadata: Metadata = {
  title: 'Portal cliente',
  description: 'Consulta tus órdenes, pagos y páginas gratis acumuladas.',
};

export default async function ClientPage() {
  const session = await requireSession('/client');
  const user = session.user as { name?: string | null; email?: string | null; role?: string | null };

  return (
    <PublicLayout>
      <ClientPortal user={{ name: user?.name, email: user?.email, role: user?.role }} />
    </PublicLayout>
  );
}
