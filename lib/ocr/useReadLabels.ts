'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useChartStore } from '@/store/chartStore';
import { readLabels } from './read';

/**
 * After detection, reads the text of every label that has none yet. Runs once per picture;
 * if the recogniser cannot start, the labels stay empty for the user to type.
 */
export function useReadLabels(): void {
  const image = useChartStore((s) => s.image);
  const status = useChartStore((s) => s.status);
  const extras = useChartStore((s) => s.extras);
  const done = useRef(new Set<string>());

  useEffect(() => {
    if (!image || status !== 'done') return;
    const pending = extras.filter(
      (e) =>
        e.kind === 'text' && e.unread && e.text === '' && !done.current.has(`${image.url}:${e.id}`),
    );
    if (pending.length === 0) return;
    for (const e of pending) done.current.add(`${image.url}:${e.id}`);
    const labels = pending.flatMap((e) => (e.kind === 'text' ? [e] : []));
    void readLabels(image.file, labels)
      .then((read) => {
        // still the same picture?
        if (useChartStore.getState().image !== image) return;
        for (const r of read) useChartStore.getState().applyReadText(r.id, r.text);
        if (read.some((r) => r.text === null)) {
          toast.message('Some text could not be read.', {
            description: 'Double-click a label on the picture to type it.',
          });
        }
      })
      .catch(() => {
        toast.message('Text could not be read automatically.', {
          description: 'Double-click a label on the picture to type it.',
        });
      });
  }, [image, status, extras]);
}
