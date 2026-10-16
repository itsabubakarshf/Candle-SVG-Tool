'use client';

import { Toaster as Sonner } from 'sonner';
import { useThemeStore } from '@/store/themeStore';

export function Toaster() {
  const theme = useThemeStore((s) => s.theme);
  return <Sonner position="bottom-center" richColors closeButton theme={theme} />;
}
