import { expect, test, type Page } from '@playwright/test';

// These run against a build whose online presets are switched on, with the network faked.
// The fake database holds one preset shared by someone else.
const DB = 'https://test.supabase.co';
const SHARED_ROW = {
  id: 'their-preset',
  user_id: 'someone-else',
  owner_name: 'Ada',
  data: {
    schemaVersion: 1,
    id: 'their-preset',
    name: 'Ada neon',
    builtIn: false,
    bull: { body: '#00FF99', border: '#00AA66', wick: '#00AA66' },
    bear: { body: '#FF3366', border: '#AA2244', wick: '#AA2244' },
    borderWidth: 1,
    wickWidth: 1,
    background: null,
  },
};

interface Fake {
  writes: { method: string; url: string; body: string }[];
  authCalls: string[];
}

/** Many presets from other people, to try searching and paging. */
const CROWD = Array.from({ length: 95 }, (_, i) => {
  const n = String(i + 1).padStart(3, '0');
  return {
    ...SHARED_ROW,
    id: `crowd-${n}`,
    user_id: i % 2 ? 'person-b' : 'person-a',
    owner_name: i % 2 ? 'Bo' : 'Cy',
    data: { ...SHARED_ROW.data, id: `crowd-${n}`, name: `Crowd ${n}` },
  };
});

async function fakeDatabase(
  page: Page,
  opts: { google?: boolean; crowd?: boolean } = {},
): Promise<Fake> {
  const fake: Fake = { writes: [], authCalls: [] };
  await page.route(`${DB}/rest/v1/presets**`, async (route) => {
    const r = route.request();
    if (r.method() === 'GET') {
      // answer like the real table: filter by owner, by search text, then page
      const q = new URL(r.url()).searchParams;
      let rows = opts.crowd ? CROWD : [SHARED_ROW];
      const owner = q.get('user_id');
      if (owner?.startsWith('eq.')) rows = rows.filter((x) => x.user_id === owner.slice(3));
      if (owner?.startsWith('neq.')) rows = rows.filter((x) => x.user_id !== owner.slice(4));
      const id = q.get('id');
      if (id?.startsWith('eq.')) rows = rows.filter((x) => x.id === id.slice(3));
      const match = /ilike\.%(.*?)%/.exec(q.get('or') ?? '');
      if (match) {
        const text = (match[1] ?? '').toLowerCase();
        rows = rows.filter(
          (x) =>
            x.data.name.toLowerCase().includes(text) || x.owner_name.toLowerCase().includes(text),
        );
      }
      if (q.get('order')?.startsWith('name'))
        rows = [...rows].sort((a, b) => a.data.name.localeCompare(b.data.name));
      const offset = Number(q.get('offset') ?? 0);
      const limit = Number(q.get('limit') ?? rows.length);
      await route.fulfill({ json: rows.slice(offset, offset + limit) });
      return;
    }
    fake.writes.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' });
    await route.fulfill({ status: 201, body: '' });
  });
  await page.route(`${DB}/auth/v1/**`, async (route) => {
    const url = new URL(route.request().url());
    fake.authCalls.push(url.pathname);
    if (url.pathname.endsWith('/authorize') && opts.google === false) {
      await route.fulfill({
        status: 400,
        headers: { 'access-control-allow-origin': '*' },
        json: {
          code: 400,
          error_code: 'validation_failed',
          msg: 'Unsupported provider: provider is not enabled',
        },
      });
      return;
    }
    if (url.pathname.endsWith('/authorize')) {
      await route.fulfill({ contentType: 'text/html', body: '<p>google</p>' });
      return;
    }
    await route.fulfill({ json: {} });
  });
  return fake;
}

/** What supabase-js keeps in localStorage for a signed-in browser. */
async function signedIn(page: Page, name: string | null) {
  await page.addInitScript(
    ([n]) => {
      const session = {
        access_token: 'a.b.c',
        refresh_token: 'r',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: 'me',
          aud: 'authenticated',
          email: 'me@example.com',
          is_anonymous: false,
          app_metadata: {},
          user_metadata: n ? { full_name: n } : {},
          created_at: '2026-01-01T00:00:00Z',
        },
      };
      localStorage.setItem('sb-test-auth-token', JSON.stringify(session));
    },
    [name],
  );
}

async function openColors(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Colors' }).click();
}

test.describe('saving presets needs an account', () => {
  test('anyone can see and pick a preset someone else shared', async ({ page }) => {
    await fakeDatabase(page);
    await openColors(page);
    const option = page.getByRole('option', { name: /Ada neon/ }).filter({ visible: true });
    await expect(option).toBeVisible();
    await expect(option).toContainText('Ada');
    await option.click();
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/belongs to someone else/).filter({ visible: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Delete' }).filter({ visible: true }),
    ).toBeDisabled();
  });

  test('a signed-out visitor who tries to save is asked to sign in', async ({ page }) => {
    const fake = await fakeDatabase(page);
    await openColors(page);
    // the sign-in button sits in the top bar, next to the theme switch
    await expect(
      page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('region', { name: 'Presets' })
      .getByRole('button', { name: 'New', exact: true })
      .filter({ visible: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Sign in to save your preset' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(dialog.getByRole('alert')).toContainText('valid email');

    await dialog.getByLabel('Email address').fill('trader@example.com');
    await dialog.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(dialog.getByRole('status')).toContainText('Check your inbox');
    expect(fake.authCalls.some((c) => c.endsWith('/otp'))).toBe(true);
    expect(fake.writes).toEqual([]); // nothing was saved
  });

  test('Google sign-in is offered and sends the visitor to Google', async ({ page }) => {
    await fakeDatabase(page);
    await openColors(page);
    await page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true }).click();
    const nav = page.waitForRequest((r) => r.url().includes('/auth/v1/authorize'));
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    expect((await nav).url()).toContain('provider=google');
  });

  test('when Google is not switched on, the visitor sees a message, not an error page', async ({
    page,
  }) => {
    await fakeDatabase(page, { google: false });
    await openColors(page);
    await page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('alert')).toContainText('Google sign-in is not available yet');
    await expect(dialog).toBeVisible();
    expect(page.url()).not.toContain('supabase');
  });

  test('a signed-in account saves its own preset, and only that is uploaded', async ({ page }) => {
    const fake = await fakeDatabase(page);
    await signedIn(page, 'Mo');
    await openColors(page);
    await expect(
      page.getByRole('banner').getByRole('button', { name: 'Sign in', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Account: Mo' }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page
      .getByRole('region', { name: 'Presets' })
      .getByRole('button', { name: 'New', exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => fake.writes.length).toBeGreaterThan(0);
    const sent = JSON.parse(fake.writes[0]!.body) as { user_id: string; id: string }[];
    expect(sent).toHaveLength(1);
    expect(sent[0]!.user_id).toBe('me');
    expect(sent.some((r) => r.id === 'their-preset')).toBe(false);
  });

  test("editing someone else's preset saves a copy that is yours", async ({ page }) => {
    const fake = await fakeDatabase(page);
    await signedIn(page, null);
    await openColors(page);
    await page
      .getByRole('option', { name: /Ada neon/ })
      .filter({ visible: true })
      .click();
    await page.getByRole('textbox', { name: 'Name' }).filter({ visible: true }).fill('My neon');
    await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).click();
    await expect.poll(() => fake.writes.length).toBeGreaterThan(0);
    const sent = JSON.parse(fake.writes[0]!.body) as { id: string; name: string }[];
    expect(sent.map((r) => r.name)).toEqual(['My neon']);
    expect(sent[0]!.id).not.toBe('their-preset');
  });
});

test.describe('lots of shared presets', () => {
  const list = (page: Page) =>
    page.getByRole('listbox', { name: 'Preset list' }).filter({ visible: true });
  const search = (page: Page) =>
    page.getByRole('textbox', { name: 'Search presets' }).filter({ visible: true });

  test('are listed a page at a time, with a clear way to get more', async ({ page }) => {
    await fakeDatabase(page, { crowd: true });
    await openColors(page);
    const crowd = list(page).getByRole('option').filter({ hasText: /Crowd/ });
    await expect(list(page).getByText('Shared by others')).toBeVisible();
    await expect(crowd).toHaveCount(40);
    await list(page).getByRole('button', { name: 'Show more' }).click();
    await expect(crowd).toHaveCount(80);
    await list(page).getByRole('button', { name: 'Show more' }).click();
    await expect(crowd).toHaveCount(95);
    await expect(list(page).getByRole('button', { name: 'Show more' })).toHaveCount(0);
    await expect(
      list(page)
        .getByText(/by (Bo|Cy)/)
        .first(),
    ).toBeVisible();
  });

  test('can be searched by name or by person', async ({ page }) => {
    await fakeDatabase(page, { crowd: true });
    await openColors(page);
    await search(page).fill('Crowd 07');
    const crowd = list(page).getByRole('option').filter({ hasText: /Crowd/ });
    await expect(crowd).toHaveCount(10); // 070 to 079
    await search(page).fill('zzz nothing');
    await expect(list(page).getByText(/Nothing matches/)).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).filter({ visible: true }).click();
    await expect(crowd.first()).toBeVisible();
  });

  test('the Mine and Shared filters, and the order', async ({ page }) => {
    await fakeDatabase(page, { crowd: true });
    await signedIn(page, 'Mo');
    await openColors(page);
    const group = page.getByRole('group', { name: 'Show' }).filter({ visible: true });
    await group.getByRole('button', { name: 'Mine' }).click();
    await expect(list(page).getByText('Presets you save appear here')).toBeVisible();
    await expect(list(page).getByText('Shared by others')).toHaveCount(0);
    await group.getByRole('button', { name: 'Shared' }).click();
    await expect(list(page).getByText('Built-in')).toHaveCount(0);
    await page.getByLabel('Order').filter({ visible: true }).selectOption('name');
    await expect(list(page).getByRole('option').first()).toContainText('Crowd 001');
  });

  test('the top bar menu stays short and points to the full list', async ({ page }) => {
    await fakeDatabase(page, { crowd: true });
    await page.goto('/');
    const select = page.getByLabel('Active preset');
    expect(await select.locator('option').count()).toBeLessThan(8);
    await select.selectOption({ label: 'Browse shared presets…' });
    await expect(page.getByRole('tab', { name: 'Colors' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('a preset picked from the list is remembered after a reload', async ({ page }) => {
    await fakeDatabase(page, { crowd: true });
    await openColors(page);
    await search(page).fill('Crowd 088');
    await list(page)
      .getByRole('option', { name: /Crowd 088/ })
      .click();
    await expect(page.getByLabel('Active preset')).toHaveValue('crowd-088');
    await page.reload();
    await expect(page.getByLabel('Active preset')).toHaveValue('crowd-088');
  });
});
