'use client';

import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole, Mail, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState, type FormEvent } from 'react';
import { apiFetch, asRecord, errorMessage, readString } from '@/lib/client-api';
import { cn } from '@/lib/utils';

export interface AuthFormProps {
  mode: 'login' | 'register';
  callbackUrl?: string;
}

export function AuthForm({ mode, callbackUrl }: AuthFormProps) {
  const router = useRouter();
  const isLogin = mode === 'login';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Introduce tu correo y contraseña.');
      return;
    }
    if (!isLogin && !name.trim()) {
      setError('Introduce tu nombre completo.');
      return;
    }
    if (password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      if (!isLogin) {
        const response = await apiFetch<unknown>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
        });
        const record = asRecord(response);
        const detail = readString(record.message);
        if (detail && /ya existe|duplicate|already/i.test(detail)) {
          throw new Error(detail);
        }
      }

      const result = await signIn('credentials', {
        redirect: false,
        email: email.trim(),
        password,
      });

      if (!result || result.error) {
        setError(
          result?.error === 'CredentialsSignin'
            ? 'Correo o contraseña incorrectos.'
            : result?.error ?? 'No se pudo iniciar sesión. Intenta de nuevo.',
        );
        return;
      }

      const target = callbackUrl && callbackUrl.startsWith('/') ? callbackUrl : '/client';
      router.push(target);
      router.refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'No se pudo completar la solicitud.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-surface-border bg-gradient-to-r from-brand-700 to-accent-600 px-6 py-6 text-white">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25">
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-xl font-extrabold">
          {isLogin ? 'Bienvenido de nuevo' : 'Crea tu cuenta'}
        </h1>
        <p className="mt-1 text-sm text-blue-50/90">
          {isLogin
            ? 'Accede a tus órdenes, páginas gratis y seguimiento en vivo.'
            : 'Regístrate para acumular beneficios y gestionar tus impresiones.'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 p-6">
        {!isLogin ? (
          <div>
            <label htmlFor="auth-name" className="label">
              Nombre completo
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-muted" aria-hidden="true" />
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ana García"
                className="input pl-9"
                required
              />
            </div>
          </div>
        ) : null}

        <div>
          <label htmlFor="auth-email" className="label">
            Correo electrónico
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-muted" aria-hidden="true" />
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="tu@correo.com"
              className="input pl-9"
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="auth-password" className="label">
            Contraseña
          </label>
          <div className="relative">
            <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-muted" aria-hidden="true" />
            <input
              id="auth-password"
              data-lp-sensitive="true"
              type={showPassword ? 'text' : 'password'}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Mínimo 6 caracteres"
              className="input px-9"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-surface-muted hover:text-surface-ink"
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-lg border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-xs text-danger-600" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        <button type="submit" disabled={loading} className={cn('btn-primary w-full py-3')}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {loading ? 'Procesando…' : isLogin ? 'Iniciar sesión' : 'Crear cuenta'}
        </button>

        <p className="text-center text-xs text-surface-muted">
          {isLogin ? '¿Aún no tienes cuenta? ' : '¿Ya tienes una cuenta? '}
          <Link
            href={isLogin ? '/register' : '/login'}
            className="font-semibold text-brand-600 hover:underline"
          >
            {isLogin ? 'Regístrate gratis' : 'Inicia sesión'}
          </Link>
        </p>
        <p className="text-center text-[11px] text-surface-muted">
          ¿Solo quieres cotizar?{' '}
          <Link href="/quote" className="font-semibold text-accent-600 hover:underline">
            Continúa como invitado
          </Link>
        </p>
      </form>
    </div>
  );
}
