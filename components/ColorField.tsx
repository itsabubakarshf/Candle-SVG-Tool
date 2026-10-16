'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { normalizeHex } from '@/lib/svg/hex';
import { cn } from '@/lib/utils';

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  /** Shown next to the label, e.g. "overridden". */
  note?: string;
}

/** Colour picker plus a hex text field. Changes apply as you drag. */
export function ColorField({ label, value, onChange, disabled, note }: ColorFieldProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // What the user is typing. It only counts while the colour it was typed against is current.
  const [typed, setTyped] = useState<{ against: string; text: string } | null>(null);
  const text = typed && typed.against === value ? typed.text : value;
  const invalid = typed !== null && typed.against === value && normalizeHex(typed.text) === null;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={root} className="relative flex items-center gap-2">
      <label htmlFor={id} className="w-24 shrink-0 text-xs text-muted-foreground">
        {label}
        {note && (
          <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">{note}</span>
        )}
      </label>
      <button
        type="button"
        aria-label={`${label}: pick a colour`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="h-7 w-7 shrink-0 rounded border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        style={{ background: value }}
      />
      <input
        id={id}
        value={text}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={invalid}
        onChange={(e) => {
          const next = e.target.value;
          setTyped({ against: value, text: next });
          // Apply full 6-digit colours as you type; short ones (#abc) apply when you leave.
          if (/^#?[0-9a-f]{6}$/i.test(next.trim())) {
            const hex = normalizeHex(next);
            if (hex && hex !== value) onChange(hex);
          }
        }}
        onBlur={() => {
          const hex = typed ? normalizeHex(typed.text) : null;
          if (hex && hex !== value) onChange(hex);
          setTyped(null);
        }}
        className={cn(
          'h-8 w-full min-w-0 rounded-md border bg-background px-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
          invalid ? 'border-red-500' : 'border-border',
        )}
      />
      {open && (
        <div className="absolute left-0 top-9 z-30 rounded-lg border border-border bg-background p-2 shadow-lg">
          <HexColorPicker color={value} onChange={(c) => onChange(c.toUpperCase())} />
        </div>
      )}
    </div>
  );
}
