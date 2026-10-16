'use client';

import { useRef, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadZoneProps {
  onFile: (file: File) => void;
}

export function UploadZone({ onFile }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Paste (Ctrl+V), drop, or click to upload a screenshot"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      className={cn(
        'flex h-full min-h-72 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-8 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        dragging && 'border-primary bg-muted',
      )}
    >
      <ImageUp className="h-10 w-10 text-muted-foreground" aria-hidden />
      <p className="text-lg font-medium">Paste (Ctrl+V), drop, or click to upload.</p>
      <p className="text-sm text-muted-foreground">
        One cropped TradingView screenshot. PNG, JPG or WEBP.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Upload screenshot"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
