'use client';

import {
  BarChart3,
  ClipboardList,
  CreditCard,
  Cpu,
  LayoutDashboard,
  Percent,
  Printer,
  Settings2,
  Tags,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { AdminModule, type AdminKey } from '@/components/AdminModule';
import { PanelShell, type PanelNavItem } from '@/components/PanelShell';

const items: PanelNavItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/admin', group: 'General' },
  { key: 'reports', label: 'Reportes / KPIs', icon: BarChart3, href: '/admin/reports', group: 'General' },
  { key: 'users', label: 'Usuarios y roles', icon: Users, href: '/admin/users', group: 'Negocio' },
  { key: 'orders', label: 'Órdenes y cola', icon: ClipboardList, href: '/admin/orders', group: 'Negocio' },
  { key: 'payments', label: 'Pagos', icon: CreditCard, href: '/admin/payments', group: 'Negocio' },
  { key: 'discounts', label: 'Descuentos', icon: Percent, href: '/admin/discounts', group: 'Negocio' },
  { key: 'tariffs', label: 'Tarifario', icon: Tags, href: '/admin/tariffs', group: 'Negocio' },
  { key: 'stations', label: 'Estaciones', icon: Cpu, href: '/admin/stations', group: 'Infraestructura' },
  { key: 'printers', label: 'Impresoras', icon: Printer, href: '/admin/printers', group: 'Infraestructura' },
  { key: 'settings', label: 'Configuración DB', icon: Settings2, href: '/admin/settings', group: 'Infraestructura' },
];

export interface AdminPanelProps {
  module: AdminKey;
  user: { name?: string | null; email?: string | null; role?: string | null };
}

export function AdminPanel({ module, user }: AdminPanelProps) {
  const current = items.find((item) => item.key === module) ?? items[0];

  return (
    <PanelShell
      title={current.label}
      subtitle="Administración integral de la operación de impresión"
      items={items}
      activeKey={module}
      user={user}
      toolbar={
        <Link href="/client" className="btn-secondary px-2.5 py-1.5 text-xs">
          Portal cliente
        </Link>
      }
    >
      <AdminModule module={module} />
    </PanelShell>
  );
}
