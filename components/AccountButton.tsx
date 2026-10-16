'use client';

import { useEffect, useRef, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cloudConfigured } from '@/lib/presets/cloud';
import { usePresetStore } from '@/store/presetStore';

/** Top right of the page, next to the theme switch: sign in, or the signed-in account's menu. */
export function AccountButton() {
  const account = usePresetStore((s) => s.account);
  const cloud = usePresetStore((s) => s.cloud);
  const setSignInOpen = usePresetStore((s) => s.setSignInOpen);
  const signOut = usePresetStore((s) => s.signOut);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!cloudConfigured()) return null;

  if (!account) {
    return (
      <Button variant="outline" size="sm" onClick={() => setSignInOpen(true)}>
        <LogIn className="h-3.5 w-3.5" aria-hidden />
        Sign in
      </Button>
    );
  }

  const label = account.name ?? account.email ?? 'Account';
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${label}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold uppercase text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label.trim().charAt(0) || '?'}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-border bg-background p-3 shadow-xl"
        >
          <p className="truncate text-sm font-medium">{label}</p>
          {account.name && account.email && (
            <p className="truncate text-xs text-muted-foreground">{account.email}</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {cloud === 'offline'
              ? 'Offline: presets are saved in this browser for now.'
              : 'Your presets and colour answers are saved to your account.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 w-full"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Sign out
          </Button>
        </div>
      )}
    </div>
  );
}
