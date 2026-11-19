import type { Metadata } from 'next';
import { EmployeePanel } from '@/components/EmployeePanel';
import { requireRole } from '@/components/server-auth';

export const metadata: Metadata = {
  title: 'Panel de empleados',
  description: 'Gestión de estaciones, impresoras y cola global de impresión.',
};

export default async function EmployeePage() {
  const session = await requireRole(['EMPLOYEE', 'ADMIN'], '/employee');
  const user = session.user as { name?: string | null; email?: string | null; role?: string | null };

  return <EmployeePanel user={{ name: user?.name, email: user?.email, role: user?.role }} />;
}
