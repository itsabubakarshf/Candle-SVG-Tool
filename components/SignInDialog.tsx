'use client';

import { useEffect, useRef, useState } from 'react';
import { Lock, Mail, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { signInWithEmail, signInWithGoogle } from '@/lib/presets/cloud';
import { usePresetStore } from '@/store/presetStore';

type EmailState = 'idle' | 'sending' | 'sent';

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

/** Asks the visitor to sign in before their preset is saved. Everything else works without it. */
export function SignInDialog() {
  const open = usePresetStore((s) => s.signInOpen);
  const setOpen = usePresetStore((s) => s.setSignInOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<EmailState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const reset = () => {
    setState('idle');
    setError(null);
  };

  const google = async () => {
    setError(null);
    const problem = await signInWithGoogle();
    if (problem) setError(problem);
  };

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(address)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setState('sending');
    const problem = await signInWithEmail(address);
    if (problem) {
      setState('idle');
      setError(problem);
      return;
    }
    setState('sent');
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="signin-title"
      onClose={() => {
        setOpen(false);
        reset();
      }}
      onClick={(e) => {
        if (e.target === ref.current) setOpen(false);
      }}
      className="m-auto w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <div className="relative bg-gradient-to-b from-muted to-background px-6 pb-4 pt-8 text-center">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2"
          onClick={() => setOpen(false)}
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </Button>
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <Lock className="h-5 w-5" aria-hidden />
        </div>
        <h2 id="signin-title" className="text-lg font-semibold tracking-tight">
          Sign in to save your preset
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Using Crisper needs no account. Saving a preset does, so it stays yours and nobody else
          can change it.
        </p>
      </div>

      <div className="space-y-4 px-6 pb-6 pt-2">
        {state === 'sent' ? (
          <div role="status" className="space-y-3 py-2 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Mail className="h-5 w-5" aria-hidden />
            </div>
            <p className="text-sm font-medium">Check your inbox</p>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to <span className="text-foreground">{email.trim()}</span>.
              Open it on this device and your preset is saved.
            </p>
            <Button variant="ghost" size="sm" onClick={reset}>
              Use a different email
            </Button>
          </div>
        ) : (
          <>
            <Button variant="outline" className="h-10 w-full" onClick={() => void google()}>
              <GoogleMark />
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={(e) => void sendLink(e)} className="space-y-2" noValidate>
              <label className="sr-only" htmlFor="signin-email">
                Email address
              </label>
              <Input
                id="signin-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={error ? true : undefined}
              />
              <Button type="submit" className="h-10 w-full" disabled={state === 'sending'}>
                <Mail className="h-4 w-4" aria-hidden />
                {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
              </Button>
            </form>
            {error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Saved presets are shared: anyone can use them, only you can change yours. Screenshots are
          never uploaded.
        </p>
      </div>
    </dialog>
  );
}
