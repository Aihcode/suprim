import type { Metadata } from 'next';
import { AdminPanel } from '@/components/AdminPanel';
import { requireRole } from '@/components/server-auth';

export const metadata: Metadata = {
  title: 'Panel de administración',
  description: 'Dashboard general de PrintFlow ERP.',
};

export default async function AdminPage() {
  const session = await requireRole(['ADMIN'], '/admin');
  const user = session.user as { name?: string | null; email?: string | null; role?: string | null };

  return <AdminPanel module="dashboard" user={{ name: user?.name, email: user?.email, role: user?.role }} />;
}
