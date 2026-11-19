'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  apiFetch,
  asArray,
  asRecord,
  readNumber,
  readString,
  type JobProgress,
  type Order,
} from '@/lib/client-api';
import { trackEvent } from '@/lib/logrocket';

function normalizeProgress(
  record: Record<string, unknown>,
  fallbackOrderId: string,
): JobProgress {
  const progress: JobProgress = { ...record, order_id: readString(record.order_id, fallbackOrderId) };
  if (record.page_current !== undefined) progress.page_current = readNumber(record.page_current);
  if (record.page_total !== undefined) progress.page_total = readNumber(record.page_total);
  progress.status = readString(record.status) || progress.status;
  progress.message = readString(record.message) || progress.message;
  return progress;
}

/**
 * Progreso en vivo de una orden: Socket.io (/client) con polling REST como fallback.
 * Los eventos `job.progress` llegan desde PrintBridge Desktop.
 */
export function useOrderProgress(id: string) {
  const [order, setOrder] = useState<Order | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [history, setHistory] = useState<JobProgress[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const lastTrackedStatus = useRef<string>('');

  const applyProgress = useCallback(
    (record: Record<string, unknown>) => {
      const next = normalizeProgress(record, id);
      setProgress(next);
      setHistory((current) => [next, ...current].slice(0, 15));
    },
    [id],
  );

  const refresh = useCallback(
    async (silent = false) => {
      if (!id) return;
      if (!silent) setLoading(true);

      let detailOk = false;
      try {
        const data = await apiFetch<unknown>(`/api/client/orders/${encodeURIComponent(id)}`);
        const record = asRecord(data);
        if (record && Object.keys(record).length > 0) {
          setOrder({ id, ...record } as Order);
          detailOk = true;
          if (record.progress && typeof record.progress === 'object') {
            applyProgress(asRecord(record.progress));
          }
        }
      } catch {
        // El seguimiento público puede funcionar sin sesión; el progreso se obtiene aparte.
      }

      try {
        const data = await apiFetch<unknown>(
          `/api/client/orders/${encodeURIComponent(id)}/progress`,
        );
        const root = asRecord(data);
        const eventList = asArray<Record<string, unknown>>(root.progress);
        const candidate =
          eventList.length === 0 ? (root.job ? asRecord(root.job) : root) : root;
        if (Object.keys(candidate).length > 0) applyProgress(candidate);
        if (eventList.length > 0) {
          setHistory(
            eventList
              .map((event) => normalizeProgress(event, id))
              .reverse()
              .slice(0, 15),
          );
        }
        const orderStatus = readString(root.order_status);
        if (orderStatus) {
          setOrder((current) => ({ id, ...(current ?? {}), status: orderStatus }) as Order);
        }
      } catch {
        // Sin progreso disponible todavía (orden recién creada o sesión invitada).
      }

      if (!silent) {
        setLoading(false);
        setError(detailOk ? null : 'No se pudo cargar el detalle completo; mostrando el progreso disponible.');
      }
    },
    [id, applyProgress],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!id || typeof window === 'undefined') return;

    let socket: Socket | null = null;
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      socket = io(baseUrl, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1500,
      });

      socket.on('connect', () => setLive(true));
      socket.on('disconnect', () => setLive(false));
      socket.on('connect_error', () => setLive(false));

      const handleProgress = (payload: unknown) => {
        const record = asRecord(payload);
        const eventOrderId = readString(record.order_id ?? record.orderId ?? record.id);
        if (eventOrderId && eventOrderId !== id) return;
        applyProgress(record);
        const printStatus = readString(record.status).toUpperCase();
        if (printStatus && printStatus !== lastTrackedStatus.current) {
          lastTrackedStatus.current = printStatus;
          trackEvent('print_progress', {
            order_id: id,
            job_id: readString(record.job_id),
            status: printStatus,
            page_current: readNumber(record.page_current),
            page_total: readNumber(record.page_total),
          });
          if (printStatus === 'COMPLETED') trackEvent('print_completed', { order_id: id });
        }
        const orderStatus = readString(record.order_status);
        if (orderStatus) {
          setOrder((current) => ({ id, ...(current ?? {}), status: orderStatus }) as Order);
        }
      };

      const handleOrder = (payload: unknown) => {
        const record = asRecord(payload);
        const eventOrderId = readString(record.id ?? record.order_id);
        if (eventOrderId && eventOrderId !== id) return;
        setOrder((current) => ({ id, ...(current ?? {}), ...record }) as Order);
      };

      ['job.progress', 'order.progress', 'order.started', 'progress'].forEach((event) => {
        socket?.on(event, handleProgress);
      });
      ['order.updated', 'order.status'].forEach((event) => {
        socket?.on(event, handleOrder);
      });

      socket.emit('client.subscribe', { order_id: id });
      socket.emit('subscribe', { order_id: id, orderId: id });
      socket.emit('order.subscribe', { order_id: id });
    } catch {
      setLive(false);
    }

    return () => {
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [id, applyProgress]);

  useEffect(() => {
    if (!id) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [id, refresh]);

  return { order, progress, history, live, loading, error, refresh };
}
