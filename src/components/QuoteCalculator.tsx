'use client';

import {
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  LockKeyhole,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useToast } from '@/components/ToastProvider';
import {
  ApiError,
  apiFetch,
  asRecord,
  errorMessage,
  readNumber,
  type CreateOrderResponse,
  type QuoteResult,
} from '@/lib/client-api';
import { cn, formatCurrency } from '@/lib/utils';

export interface QuoteInitial {
  pages?: number;
  copies?: number;
  color?: boolean;
  duplex?: boolean;
  paper_size?: string;
}

export interface QuoteCalculatorProps {
  mode?: 'compact' | 'full';
  initial?: QuoteInitial;
  className?: string;
}

/** Conteo heurístico de páginas de un PDF sin dependencias adicionales. */
async function detectPdfPages(file: File): Promise<number | null> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return null;
  try {
    const buffer = await file.slice(0, 2 * 1024 * 1024).arrayBuffer();
    const raw = new TextDecoder('latin1').decode(buffer);
    const pageObjects = (raw.match(/\/Type\s*\/Page\b/g) ?? []).length;
    if (pageObjects > 0) return Math.min(pageObjects, 10_000);
    const counts = Array.from(raw.matchAll(/\/Count\s+(\d+)/g))
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0);
    return counts.length > 0 ? Math.min(Math.max(...counts), 10_000) : null;
  } catch {
    return null;
  }
}

function humanizeKey(key: string): string {
  return key.replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Breakdown({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    const items = value.map((item, index) => {
      const record = asRecord(item);
      const label = String(record.label ?? record.name ?? record.key ?? `Concepto ${index + 1}`);
      const amount = record.value ?? record.amount ?? record.price ?? record.total;
      return { label, amount };
    });
    if (items.length === 0) return null;
    return (
      <dl className="grid gap-1.5 text-xs">
        {items.map((item, index) => (
          <div key={`${item.label}-${index}`} className="flex justify-between gap-3">
            <dt className="text-surface-muted">{humanizeKey(item.label)}</dt>
            <dd className="font-medium tabular-nums text-surface-ink">
              {typeof item.amount === 'number' ? formatCurrency(item.amount) : String(item.amount ?? '—')}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const entries = Object.entries(asRecord(value));
  if (entries.length === 0) return null;
  return (
    <dl className="grid gap-1.5 text-xs">
      {entries.map(([key, amount]) => (
        <div key={key} className="flex justify-between gap-3">
          <dt className="text-surface-muted">{humanizeKey(key)}</dt>
          <dd className="font-medium tabular-nums text-surface-ink">
            {typeof amount === 'number' ? formatCurrency(amount) : String(amount)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function QuoteCalculator({ mode = 'full', initial, className }: QuoteCalculatorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { data: session, status } = useSession();

  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState(Math.max(1, readNumber(initial?.pages, 1)));
  const [copies, setCopies] = useState(Math.max(1, readNumber(initial?.copies, 1)));
  const [color, setColor] = useState(initial?.color ?? false);
  const [duplex, setDuplex] = useState(initial?.duplex ?? false);
  const [paperSize, setPaperSize] = useState(initial?.paper_size === 'Letter' ? 'Letter' : 'A4');
  const [detecting, setDetecting] = useState(false);
  const [detectionNote, setDetectionNote] = useState<string | null>(null);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestRef = useRef(0);

  const userId = (session?.user as { id?: string } | undefined)?.id;
  const isGuest = status !== 'authenticated';

  useEffect(() => {
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(async () => {
      setCalculating(true);
      setQuoteError(null);
      try {
        const result = await apiFetch<QuoteResult>('/api/quote/calculate', {
          method: 'POST',
          body: JSON.stringify({
            file_pages: pages,
            copies,
            color,
            duplex,
            paper_size: paperSize,
            ...(userId ? { user_id: userId } : {}),
          }),
        });
        if (requestId === requestRef.current) setQuote(result);
      } catch (cause) {
        if (requestId === requestRef.current) {
          setQuote(null);
          setQuoteError(errorMessage(cause, 'No se pudo calcular el precio.'));
        }
      } finally {
        if (requestId === requestRef.current) setCalculating(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [pages, copies, color, duplex, paperSize, userId]);

  async function handleFile(selected: File | null) {
    if (!selected) return;
    setFile(selected);
    setDetectionNote(null);
    setDetecting(true);
    const detected = await detectPdfPages(selected);
    if (detected) {
      setPages(detected);
      setDetectionNote(`Se detectaron ${detected} páginas en el PDF. Puedes ajustarlas si lo necesitas.`);
    } else {
      setDetectionNote('No pudimos detectar las páginas automáticamente. Indícalas manualmente.');
    }
    setDetecting(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) void handleFile(dropped);
  }

  async function handleSubmit() {
    if (!file) {
      toast({ title: 'Falta el archivo', description: 'Selecciona el documento que deseas imprimir.', variant: 'warning' });
      return;
    }
    if (pages < 1 || copies < 1) {
      toast({ title: 'Revisa la cantidad', description: 'Páginas y copias deben ser mayores a cero.', variant: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('copies', String(copies));
      formData.append('color', String(color));
      formData.append('duplex', String(duplex));
      formData.append('paper_size', paperSize);
      formData.append('pages', String(pages));

      const response = await apiFetch<CreateOrderResponse>('/api/client/orders', {
        method: 'POST',
        body: formData,
      });
      const orderId = response.order?.id ?? response.id;
      if (!orderId) throw new Error('El servidor no devolvió el identificador de la orden.');
      toast({ title: 'Orden creada', description: 'Continúa con el pago para enviar el trabajo a imprimir.', variant: 'success' });
      router.push(`/checkout/${encodeURIComponent(orderId)}`);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        toast({
          title: 'Inicia sesión para continuar',
          description: 'La creación de órdenes requiere una sesión activa. Te llevamos al acceso.',
          variant: 'warning',
        });
        router.push('/login?callbackUrl=%2Fquote');
        return;
      }
      toast({
        title: 'No se pudo crear la orden',
        description: errorMessage(cause, 'Revisa los datos e inténtalo de nuevo.'),
        variant: 'error',
      });
      setSubmitting(false);
    }
  }

  const total = readNumber(quote?.total_price, 0);
  const base = readNumber(quote?.base_price, 0);
  const discount = readNumber(quote?.discount, 0);
  const freePages = readNumber(quote?.free_pages, 0);
  const savings = Math.max(0, base - total);

  return (
    <div className={cn('card overflow-hidden', className)}>
      <div className="border-b border-surface-border bg-gradient-to-r from-brand-50 to-accent-50 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <h2 className="text-sm font-bold text-surface-ink sm:text-base">
            {mode === 'compact' ? 'Cotiza tu impresión al instante' : 'Configura tu trabajo de impresión'}
          </h2>
        </div>
        <p className="mt-1 text-xs text-surface-muted">
          Precio en vivo con descuentos e impresiones gratis aplicados automáticamente.
        </p>
      </div>

      <div className={cn('grid gap-5 p-4 sm:p-5', mode === 'full' && 'lg:grid-cols-[1.15fr_0.85fr]')}>
        <div className="space-y-4">
          <label
            htmlFor="quote-file"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-brand-500/30 bg-brand-50/40 px-4 py-5 text-center transition hover:border-brand-500 hover:bg-brand-50"
          >
            <input
              id="quote-file"
              type="file"
              className="sr-only"
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt"
              onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
            />
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-brand-600 shadow-sm">
              {detecting ? <Loader2 className="h-5 w-5 animate-spin" /> : <UploadCloud className="h-5 w-5" />}
            </span>
            <span className="mt-2 text-sm font-semibold text-surface-ink">
              {file ? file.name : 'Sube tu archivo o arrástralo aquí'}
            </span>
            <span className="mt-0.5 text-xs text-surface-muted">
              PDF, Word, imágenes o TXT · se detectan páginas de PDF automáticamente
            </span>
            {file ? (
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-brand-600 ring-1 ring-inset ring-brand-500/20">
                <FileText className="h-3 w-3" aria-hidden="true" />
                {(file.size / 1024).toFixed(0)} KB · cambiar archivo
              </span>
            ) : null}
          </label>

          {detectionNote ? (
            <p className="flex items-start gap-1.5 text-xs text-surface-muted">
              <Info className="mt-px h-3.5 w-3.5 shrink-0 text-accent-600" aria-hidden="true" />
              {detectionNote}
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="quote-pages" className="label">
                Páginas
              </label>
              <input
                id="quote-pages"
                type="number"
                min={1}
                max={10000}
                value={pages}
                onChange={(event) => setPages(Math.max(1, Number(event.target.value) || 1))}
                className="input"
              />
            </div>
            <div>
              <label htmlFor="quote-copies" className="label">
                Copias
              </label>
              <input
                id="quote-copies"
                type="number"
                min={1}
                max={1000}
                value={copies}
                onChange={(event) => setCopies(Math.max(1, Number(event.target.value) || 1))}
                className="input"
              />
            </div>
          </div>

          <div>
            <span className="label">Tipo de impresión</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setColor(false)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-semibold transition',
                  !color ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-surface-border bg-white text-surface-muted hover:text-surface-ink',
                )}
                aria-pressed={!color}
              >
                Blanco y negro
              </button>
              <button
                type="button"
                onClick={() => setColor(true)}
                className={cn(
                  'rounded-lg border px-3 py-2.5 text-sm font-semibold transition',
                  color ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-surface-border bg-white text-surface-muted hover:text-surface-ink',
                )}
                aria-pressed={color}
              >
                A color
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="quote-paper" className="label">
                Tamaño de papel
              </label>
              <select
                id="quote-paper"
                value={paperSize}
                onChange={(event) => setPaperSize(event.target.value === 'Letter' ? 'Letter' : 'A4')}
                className="input"
              >
                <option value="A4">A4 · 210 × 297 mm</option>
                <option value="Letter">Letter · 8.5 × 11 in</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setDuplex((value) => !value)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold transition',
                  duplex ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-surface-border bg-white text-surface-muted hover:text-surface-ink',
                )}
                aria-pressed={duplex}
              >
                <span>Dúplex (dos caras)</span>
                <span className={cn('relative h-5 w-9 rounded-full transition', duplex ? 'bg-brand-500' : 'bg-surface-border')}>
                  <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', duplex ? 'left-[18px]' : 'left-0.5')} />
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col rounded-lg border border-surface-border bg-surface-light p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-surface-muted">Resumen de cotización</p>
            {calculating ? (
              <span className="flex items-center gap-1 text-[11px] text-brand-600">
                <Loader2 className="h-3 w-3 animate-spin" /> Calculando…
              </span>
            ) : null}
          </div>

          {quoteError ? (
            <p className="mt-3 rounded-md border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-xs text-danger-600" role="alert">
              {quoteError}
            </p>
          ) : null}

          <div className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-surface-muted">Precio base</span>
              <span className="font-medium tabular-nums text-surface-ink">{formatCurrency(base)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-surface-muted">Descuento aplicado</span>
              <span className="font-medium tabular-nums text-success-600">−{formatCurrency(discount)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-surface-muted">Páginas gratis</span>
              <span className="font-medium tabular-nums text-accent-600">{freePages}</span>
            </div>
            {quote?.breakdown ? (
              <div className="border-t border-surface-border pt-2">
                <Breakdown value={quote.breakdown} />
              </div>
            ) : null}
            <div className="flex items-end justify-between gap-3 border-t border-surface-border pt-3">
              <span className="text-sm font-bold text-surface-ink">Total</span>
              <span className="text-2xl font-extrabold tabular-nums text-brand-600">
                {calculating && !quote ? '—' : formatCurrency(total)}
              </span>
            </div>
          </div>

          {savings > 0 || freePages > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {savings > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success-500/10 px-2.5 py-1 text-[11px] font-bold text-success-600 ring-1 ring-inset ring-success-500/20">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ahorras {formatCurrency(savings)}
                </span>
              ) : null}
              {freePages > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/10 px-2.5 py-1 text-[11px] font-bold text-accent-600 ring-1 ring-inset ring-accent-500/20">
                  <Sparkles className="h-3 w-3" aria-hidden="true" /> {freePages} páginas gratis
                </span>
              ) : null}
            </div>
          ) : null}

          {isGuest ? (
            <p className="mt-3 rounded-md border border-warning-500/25 bg-warning-500/5 px-3 py-2 text-[11px] leading-relaxed text-warning-600">
              Estás cotizando como invitado. Puedes continuar sin cuenta; iniciar sesión te permite
              acumular beneficios y ver tu historial.
            </p>
          ) : null}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="btn-primary mt-4 w-full justify-center py-3 text-sm"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            {submitting ? 'Creando orden…' : 'Continuar al pago'}
          </button>
          <p className="mt-2 text-center text-[11px] text-surface-muted">
            Sin cargos ocultos · Pago seguro Stripe / PayPal
          </p>
        </div>
      </div>
    </div>
  );
}
