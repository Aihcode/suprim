import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AdminPanel } from '@/components/AdminPanel';
import type { AdminKey } from '@/components/AdminModule';
import { requireRole } from '@/components/server-auth';

export const metadata: Metadata = {
  title: 'Administración',
  description: 'Módulos de administración de PrintFlow ERP.',
};

const modules: AdminKey[] = [
  'dashboard',
  'users',
  'stations',
  'printers',
  'orders',
  'discounts',
  'tariffs',
  'payments',
  'reports',
  'settings',
];

export default async function AdminModulePage({
  params,
}: {
  params: { module: string };
}) {
  if (!modules.includes(params.module as AdminKey)) notFound();
  const session = await requireRole(['ADMIN'], `/admin/${params.module}`);
  const user = session.user as { name?: string | null; email?: string | null; role?: string | null };

  return (
    <AdminPanel
      module={params.module as AdminKey}
      user={{ name: user?.name, email: user?.email, role: user?.role }}
    />
  );
}
