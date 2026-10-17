'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Search,
  ShieldBan,
  ShieldCheck,
} from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  adminPresets,
  adminSetBlocked,
  adminSetPresetHidden,
  adminUsers,
  isAdmin,
  type AdminPreset,
  type AdminUser,
} from '@/lib/admin/api';
import { toCsv } from '@/lib/admin/csv';
import { downloadText } from '@/lib/export/download';
import { cloudConfigured, watchAccount, type Account } from '@/lib/presets/cloud';
import { cn } from '@/lib/utils';

type Gate = 'loading' | 'signed-out' | 'denied' | 'ok';
type Tab = 'users' | 'presets';

const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '–';
const stamp = () => new Date().toISOString().slice(0, 10);

function swatches(data: unknown): string[] {
  const d = data as { bull?: { body?: string; border?: string }; bear?: { body?: string } } | null;
  return [d?.bull?.body, d?.bull?.border, d?.bear?.body].filter(
    (c): c is string => typeof c === 'string',
  );
}

/** The site owner's page: people, their presets, blocking, hiding and exports. */
export function AdminDashboard() {
  const [account, setAccount] = useState<Account | null>(null);
  const [gate, setGate] = useState<Gate>(() => (cloudConfigured() ? 'loading' : 'denied'));
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [presets, setPresets] = useState<AdminPreset[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [u, p] = await Promise.all([adminUsers(), adminPresets()]);
    setLoading(false);
    if (u === null || p === null) {
      toast.error('Could not load the data. Try Refresh.');
      return;
    }
    setUsers(u);
    setPresets(p);
  }, []);

  useEffect(() => {
    if (!cloudConfigured()) return;
    return watchAccount((a) => setAccount(a));
  }, []);

  useEffect(() => {
    let live = true;
    if (!cloudConfigured()) return;
    if (!account) {
      // the session is read a moment after load; give it that moment before saying "signed out"
      const t = setTimeout(
        () => live && setGate((g) => (g === 'loading' ? 'signed-out' : g)),
        1500,
      );
      return () => {
        live = false;
        clearTimeout(t);
      };
    }
    void isAdmin().then((yes) => {
      if (!live) return;
      setGate(yes ? 'ok' : 'denied');
      if (yes) void load();
    });
    return () => {
      live = false;
    };
  }, [account, load]);

  const q = query.trim().toLowerCase();
  const shownUsers = useMemo(
    () =>
      users.filter(
        (u) =>
          !q ||
          (u.name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q),
      ),
    [users, q],
  );
  const shownPresets = useMemo(
    () =>
      presets.filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          (p.owner_name ?? '').toLowerCase().includes(q) ||
          (p.email ?? '').toLowerCase().includes(q),
      ),
    [presets, q],
  );

  const block = async (u: AdminUser) => {
    const next = !u.blocked;
    if (
      next &&
      !window.confirm(
        `Block ${u.email ?? u.name ?? 'this person'}? Their presets will be hidden and they can't save.`,
      )
    )
      return;
    setBusy(u.id);
    const ok = await adminSetBlocked(u.id, next);
    setBusy(null);
    if (!ok) {
      toast.error('That did not work.');
      return;
    }
    toast.success(next ? 'Blocked.' : 'Unblocked.');
    void load();
  };

  const hide = async (p: AdminPreset) => {
    setBusy(`${p.user_id}/${p.id}`);
    const ok = await adminSetPresetHidden(p.user_id, p.id, !p.hidden);
    setBusy(null);
    if (!ok) {
      toast.error('That did not work.');
      return;
    }
    toast.success(p.hidden ? 'Visible to everyone again.' : 'Hidden from everyone.');
    void load();
  };

  const exportUsers = () =>
    downloadText(
      toCsv(
        [
          'Name',
          'Email',
          'Signed in with',
          'Joined',
          'Last sign-in',
          'Presets',
          'Blocked',
          'User id',
        ],
        users.map((u) => [
          u.name,
          u.email,
          u.provider,
          u.created_at,
          u.last_sign_in_at,
          u.presets,
          u.blocked,
          u.id,
        ]),
      ),
      `crisper-users-${stamp()}.csv`,
      'text/csv',
    );
  const exportPresets = () =>
    downloadText(
      toCsv(
        ['Preset', 'By', 'Email', 'Updated', 'Hidden', 'Owner blocked', 'Preset id', 'User id'],
        presets.map((p) => [
          p.name,
          p.owner_name,
          p.email,
          p.updated_at,
          p.hidden,
          p.blocked,
          p.id,
          p.user_id,
        ]),
      ),
      `crisper-presets-${stamp()}.csv`,
      'text/csv',
    );
  const exportAll = () =>
    downloadText(
      JSON.stringify({ exportedAt: new Date().toISOString(), users, presets }, null, 2),
      `crisper-data-${stamp()}.json`,
      'application/json',
    );

  if (gate !== 'ok') {
    const text = {
      loading: 'Checking who you are…',
      'signed-out': 'Sign in on the main page first, with the owner account.',
      denied: 'This page is only for the owner of Crisper.',
    }[gate];
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        {gate === 'loading' && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        )}
        <p className="text-sm text-muted-foreground" data-testid="admin-gate">
          {text}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to Crisper
          </Link>
        </Button>
      </main>
    );
  }

  const blockedCount = users.filter((u) => u.blocked).length;
  const hiddenCount = presets.filter((p) => p.hidden).length;

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Crisper
          </Link>
        </Button>
        <h1 className="text-base font-semibold">Dashboard</h1>
        <span className="text-xs text-muted-foreground">{account?.email}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportUsers}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Users CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportPresets}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Presets CSV
          </Button>
          <Button size="sm" onClick={exportAll}>
            <Download className="h-3.5 w-3.5" aria-hidden />
            All data (JSON)
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 p-4">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Totals">
          {[
            ['People', users.length],
            ['Presets', presets.length],
            ['Blocked', blockedCount],
            ['Hidden presets', hiddenCount],
          ].map(([label, n]) => (
            <div key={label} className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{n}</p>
            </div>
          ))}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" className="inline-flex rounded-md bg-muted p-0.5 text-sm">
            {(['users', 'presets'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded px-3 py-1.5 capitalize',
                  tab === t ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground',
                )}
              >
                {t === 'users' ? `People (${users.length})` : `Presets (${presets.length})`}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                tab === 'users' ? 'Search name or email' : 'Search preset, name or email'
              }
              aria-label="Search"
              className="h-9 pl-8"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          {tab === 'users' ? (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  {[
                    'Name',
                    'Email',
                    'Signed in with',
                    'Joined',
                    'Last seen',
                    'Presets',
                    'Status',
                    '',
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownUsers.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="px-3 py-2">{u.name ?? '–'}</td>
                    <td className="px-3 py-2">{u.email ?? '–'}</td>
                    <td className="px-3 py-2 capitalize">{u.provider ?? '–'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{day(u.created_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{day(u.last_sign_in_at)}</td>
                    <td className="px-3 py-2 tabular-nums">{u.presets}</td>
                    <td className="px-3 py-2">
                      {u.blocked ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                          Blocked
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Active</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {u.id !== account?.id && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === u.id}
                          onClick={() => void block(u)}
                        >
                          {u.blocked ? (
                            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                          ) : (
                            <ShieldBan className="h-3.5 w-3.5" aria-hidden />
                          )}
                          {u.blocked ? 'Unblock' : 'Block'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {shownUsers.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                      {q ? 'Nobody matches.' : 'Nobody has signed up yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  {['Preset', 'By', 'Email', 'Updated', 'Status', ''].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownPresets.map((p) => (
                  <tr key={`${p.user_id}/${p.id}`} className="border-t border-border">
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="flex gap-0.5" aria-hidden>
                          {swatches(p.data).map((c, i) => (
                            <span
                              key={i}
                              className="h-3 w-3 rounded-sm border border-border"
                              style={{ background: c }}
                            />
                          ))}
                        </span>
                        {p.name}
                      </span>
                    </td>
                    <td className="px-3 py-2">{p.owner_name ?? '–'}</td>
                    <td className="px-3 py-2">{p.email ?? '–'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{day(p.updated_at)}</td>
                    <td className="px-3 py-2">
                      {p.blocked ? 'Owner blocked' : p.hidden ? 'Hidden' : 'Public'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === `${p.user_id}/${p.id}`}
                        onClick={() => void hide(p)}
                      >
                        {p.hidden ? (
                          <Eye className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {p.hidden ? 'Show' : 'Hide'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {shownPresets.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                      {q ? 'No preset matches.' : 'No presets saved yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Blocking and hiding can be undone. A blocked person&apos;s presets disappear for everyone
          and they cannot save until unblocked. Exports contain email addresses: keep them private.
        </p>
      </main>
      <Toaster />
    </div>
  );
}
