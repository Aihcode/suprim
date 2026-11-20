'use client';

import { Cpu, Printer, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { LivePrinterBadge } from '@/components/LivePrinterBadge';
import { asArray, asRecord, readString } from '@/lib/client-api';

interface StationCard {
  id: string;
  name: string;
  location: string;
  status: string;
  lastSeen: string | null;
  printers: number;
}

export function LiveStations() {
  const [stations, setStations] = useState<StationCard[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: ReturnType<typeof io> | null = null;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      // El estado de estaciones se difunde por el namespace /admin.
      socket = io(`${baseUrl.replace(/\/$/, '')}/admin`, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
      });
      socket.on('connect', () => setConnected(true));
      socket.on('disconnect', () => setConnected(false));
      socket.on('connect_error', () => setConnected(false));

      const handleStations = (payload: unknown) => {
        const records = asArray<Record<string, unknown>>(
          asRecord(payload).stations ?? asRecord(payload).data ?? payload,
        );
        if (records.length === 0) return;
        setStations(
          records.slice(0, 3).map((record, index) => ({
            id: readString(record.id, `station-${index}`),
            name: readString(record.name ?? record.computer_name, `Estación ${index + 1}`),
            location: readString(record.location ?? record.computer_name, 'PrintBridge Desktop'),
            status: readString(record.status ?? (record.last_seen ? 'ONLINE' : 'OFFLINE'), 'OFFLINE'),
            lastSeen: record.last_seen ? readString(record.last_seen) : null,
            printers: Number(record.printers ?? 1) || 1,
          })),
        );
      };
      socket.on('stations.status', handleStations);
      socket.on('station.status', handleStations);
    } catch {
      setConnected(false);
    }
    return () => {
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, []);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-accent-600">
            PrintBridge Desktop
          </p>
          <h2 className="section-title mt-1">Estaciones conectadas en vivo</h2>
          <p className="section-subtitle">
            Las computadoras de la imprenta reciben los trabajos pagados e informan el progreso
            página por página.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-surface-border bg-white px-3 py-1.5 text-xs font-medium text-surface-muted">
          <Radio className={`h-4 w-4 ${connected ? 'animate-pulse-dot text-accent-600' : 'text-surface-muted'}`} aria-hidden="true" />
          {connected ? 'Canal en tiempo real activo' : 'Telemetría en espera'}
        </div>
      </div>

      {stations.length === 0 ? (
        <div className="card p-6 text-center text-sm text-surface-muted">
          No hay estaciones PrintBridge registradas todavía. Crea una en Admin › Estaciones y
          pega su ID y token en el agente de escritorio.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stations.map((station) => (
            <div key={station.id} className="card flex items-start gap-3 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Cpu className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-bold text-surface-ink">{station.name}</p>
                  <LivePrinterBadge status={station.status} lastSeen={station.lastSeen} />
                </div>
                <p className="mt-0.5 truncate text-xs text-surface-muted">{station.location}</p>
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-surface-muted">
                  <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                  {station.printers} impresora{station.printers === 1 ? '' : 's'} disponible{station.printers === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-surface-muted">
        Estado real de las estaciones. Se actualiza al autenticar, al recibir telemetría y al
        desconectar cada agente PrintBridge.
      </p>
    </div>
  );
}
