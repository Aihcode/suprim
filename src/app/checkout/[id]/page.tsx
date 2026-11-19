import type { Metadata } from 'next';
import { CheckoutView } from '@/components/CheckoutView';
import { PublicLayout } from '@/components/PublicLayout';

export const metadata: Metadata = {
  title: 'Checkout y seguimiento',
  description: 'Revisa tu orden, paga de forma segura y sigue la impresión en tiempo real.',
};

export default function CheckoutPage({ params }: { params: { id: string } }) {
  return (
    <PublicLayout>
      <CheckoutView id={params.id} />
    </PublicLayout>
  );
}
