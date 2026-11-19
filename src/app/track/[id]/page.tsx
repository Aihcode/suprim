import type { Metadata } from 'next';
import { PublicLayout } from '@/components/PublicLayout';
import { TrackView } from '@/components/TrackView';

export const metadata: Metadata = {
  title: 'Rastrear orden',
  description: 'Consulta en tiempo real el estado y el progreso de tu orden de impresión.',
};

export default function TrackPage({ params }: { params: { id: string } }) {
  return (
    <PublicLayout>
      <TrackView id={params.id} />
    </PublicLayout>
  );
}
