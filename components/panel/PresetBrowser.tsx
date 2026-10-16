'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ORIGINAL_ID, ORIGINAL_NAME } from '@/lib/presets/builtins';
import type { Preset } from '@/lib/presets/types';
import { usePresetStore } from '@/store/presetStore';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'mine' | 'shared';

const matches = (p: Preset, q: string) =>
  !q ||
  p.name.toLowerCase().includes(q) ||
  (p.community?.ownerName ?? '').toLowerCase().includes(q);

function Swatches({ p }: { p: Preset }) {
  return (
    <span className="ml-2 flex shrink-0 gap-0.5" aria-hidden>
      {[p.bull.body, p.bull.border, p.bear.body].map((c, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-sm border border-border"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}

function Row({
  active,
  onPick,
  title,
  by,
  swatches,
  hint,
}: {
  active: boolean;
  onPick: () => void;
  title: string;
  by?: string;
  swatches?: Preset;
  hint?: string;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onPick}
        className={cn(
          'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active && 'bg-muted font-medium',
        )}
      >
        <span className="min-w-0">
          <span className="block truncate">{title}</span>
          {by && (
            <span className="block truncate text-[11px] font-normal text-muted-foreground">
              by {by}
            </span>
          )}
        </span>
        <span className="ml-2 flex shrink-0 items-center">
          {hint && (
            <span className="text-[10px] font-normal uppercase text-muted-foreground">{hint}</span>
          )}
          {swatches && <Swatches p={swatches} />}
          {active && <Check className="ml-2 h-3.5 w-3.5" aria-hidden />}
        </span>
      </button>
    </li>
  );
}

function Group({
  label,
  count,
  children,
}: {
  label: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <li role="presentation">
      <div className="sticky top-0 z-[1] flex items-center justify-between bg-background px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {count && <span className="font-normal normal-case">{count}</span>}
      </div>
      <ul role="presentation" className="space-y-0.5">
        {children}
      </ul>
    </li>
  );
}

/**
 * The list of presets: built-ins, the ones you made, and the ones other people shared. It stays
 * usable when there are hundreds: search, a Mine / Shared filter, an order, and shared presets
 * that arrive a page at a time.
 */
export function PresetBrowser() {
  const presets = usePresetStore((s) => s.presets);
  const activeId = usePresetStore((s) => s.activeId);
  const setActive = usePresetStore((s) => s.setActive);
  const cloud = usePresetStore((s) => s.cloud);
  const sort = usePresetStore((s) => s.sharedSort);
  const setSort = usePresetStore((s) => s.setSharedSort);
  const hasMore = usePresetStore((s) => s.sharedHasMore);
  const loading = usePresetStore((s) => s.sharedLoading);
  const searchShared = usePresetStore((s) => s.searchShared);
  const loadMore = usePresetStore((s) => s.loadMoreShared);
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const online = cloud !== 'off';
  const q = text.trim().toLowerCase();

  // Searching asks the database too, after a short pause, so every shared preset is findable.
  useEffect(() => {
    if (!online) return;
    const t = setTimeout(() => searchShared(text), 300);
    return () => clearTimeout(t);
  }, [text, online, searchShared]);

  const { builtIn, mine, shared } = useMemo(() => {
    const byName = (a: Preset, b: Preset) => a.name.localeCompare(b.name);
    const own = presets.filter((p) => !p.builtIn && matches(p, q));
    return {
      builtIn: presets.filter((p) => p.builtIn && !p.community && matches(p, q)),
      mine: sort === 'name' ? [...own].sort(byName) : [...own].reverse(),
      shared: presets.filter((p) => p.community && matches(p, q)),
    };
  }, [presets, q, sort]);

  const showOriginal = filter === 'all' && (!q || ORIGINAL_NAME.toLowerCase().includes(q));
  const showBuiltIn = filter === 'all' && builtIn.length > 0;
  const showMine = filter !== 'shared';
  const showShared = online && filter !== 'mine';
  const nothing =
    !showOriginal &&
    !showBuiltIn &&
    (!showMine || mine.length === 0) &&
    (!showShared || shared.length === 0);

  return (
    <div className="space-y-2">
      {online && (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Search presets or people"
              aria-label="Search presets"
              maxLength={40}
              className="h-9 pl-8 pr-8"
            />
            {text && (
              <button
                type="button"
                onClick={() => setText('')}
                aria-label="Clear search"
                className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <div
              role="group"
              aria-label="Show"
              className="inline-flex rounded-md bg-muted p-0.5 text-xs"
            >
              {(['all', 'mine', 'shared'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded px-2.5 py-1 capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    filter === f ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground',
                  )}
                >
                  {f === 'shared' ? 'Shared' : f === 'mine' ? 'Mine' : 'All'}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Order
              <select
                aria-label="Order"
                value={sort}
                onChange={(e) => setSort(e.target.value as 'new' | 'name')}
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="new">Newest</option>
                <option value="name">A to Z</option>
              </select>
            </label>
          </div>
        </>
      )}

      <ul
        role="listbox"
        aria-label="Preset list"
        className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border p-1"
      >
        {showOriginal && (
          <Row
            active={activeId === ORIGINAL_ID}
            onPick={() => setActive(ORIGINAL_ID)}
            title={ORIGINAL_NAME}
            hint="from your chart"
          />
        )}
        {showBuiltIn && (
          <Group label="Built-in">
            {builtIn.map((p) => (
              <Row
                key={p.id}
                active={p.id === activeId}
                onPick={() => setActive(p.id)}
                title={p.name}
                swatches={p}
              />
            ))}
          </Group>
        )}
        {showMine && (online || mine.length > 0) && (
          <Group label="Mine" count={String(mine.length)}>
            {mine.length === 0 && !q ? (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                Presets you save appear here. Only you can change them.
              </li>
            ) : (
              mine.map((p) => (
                <Row
                  key={p.id}
                  active={p.id === activeId}
                  onPick={() => setActive(p.id)}
                  title={p.name}
                  swatches={p}
                />
              ))
            )}
          </Group>
        )}
        {showShared && (
          <Group
            label="Shared by others"
            count={shared.length > 0 ? `${shared.length}${hasMore ? '+' : ''}` : undefined}
          >
            {shared.map((p) => (
              <Row
                key={p.id}
                active={p.id === activeId}
                onPick={() => setActive(p.id)}
                title={p.name}
                by={p.community?.ownerName ?? 'someone'}
                swatches={p}
              />
            ))}
            {shared.length === 0 && !loading && (
              <li className="px-2 py-2 text-xs text-muted-foreground">
                {cloud === 'offline'
                  ? "Shared presets can't be reached right now."
                  : q
                    ? 'No shared preset matches.'
                    : 'Nothing shared yet. Save a preset and be the first.'}
              </li>
            )}
            {(hasMore || loading) && (
              <li className="px-1 py-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={loadMore}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                  {loading ? 'Loading…' : 'Show more'}
                </Button>
              </li>
            )}
          </Group>
        )}
        {nothing && !loading && (
          <li className="px-2 py-3 text-center text-xs text-muted-foreground">
            Nothing matches “{text.trim()}”.
          </li>
        )}
      </ul>
    </div>
  );
}
