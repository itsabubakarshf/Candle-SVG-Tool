import { expect, test, type Page } from '@playwright/test';

// Runs against the build with online presets switched on (see playwright.config.ts), with the
// database faked. The real guard is in the database; these check what the page shows and sends.
const DB = 'https://test.supabase.co';
const PRESET = {
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
const USERS = [
  {
    id: 'me',
    email: 'owner@example.com',
    name: 'Owner',
    provider: 'google',
    created_at: '2026-10-01T00:00:00Z',
    last_sign_in_at: '2026-10-17T00:00:00Z',
    blocked: false,
    presets: 0,
  },
  {
    id: 'someone-else',
    email: 'ada@example.com',
    name: 'Ada',
    provider: 'email',
    created_at: '2026-10-02T00:00:00Z',
    last_sign_in_at: null,
    blocked: false,
    presets: 1,
  },
];

async function fake(page: Page, admin: boolean) {
  const calls: { fn: string; body: string }[] = [];
  await page.route(`${DB}/rest/v1/presets**`, (route) => {
    const q = new URL(route.request().url()).searchParams;
    const owner = q.get('user_id');
    const mine = owner?.startsWith('eq.');
    void route.fulfill({ json: mine ? [] : [PRESET] });
  });
  await page.route(`${DB}/rest/v1/rpc/**`, (route) => {
    const fn = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    calls.push({ fn, body: route.request().postData() ?? '' });
    if (fn === 'is_admin') return route.fulfill({ json: admin });
    if (!admin) return route.fulfill({ status: 403, json: { message: 'not allowed' } });
    if (fn === 'admin_users') return route.fulfill({ json: USERS });
    if (fn === 'admin_presets')
      return route.fulfill({
        json: [
          {
            ...PRESET,
            name: 'Ada neon',
            email: 'ada@example.com',
            updated_at: '2026-10-16T00:00:00Z',
            hidden: false,
            blocked: false,
          },
        ],
      });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route(`${DB}/auth/v1/**`, (route) => route.fulfill({ json: {} }));
  await page.addInitScript(() => {
    const session = {
      access_token: 'a.b.c',
      refresh_token: 'r',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {
        id: 'me',
        aud: 'authenticated',
        email: 'owner@example.com',
        is_anonymous: false,
        app_metadata: {},
        user_metadata: { full_name: 'Owner' },
        created_at: '2026-01-01T00:00:00Z',
      },
    };
    localStorage.setItem('sb-test-auth-token', JSON.stringify(session));
  });
  return calls;
}

test.describe('the owner dashboard', () => {
  test('the owner sees a Dashboard button, people, presets, and can block and export', async ({
    page,
  }) => {
    const calls = await fake(page, true);
    await page.goto('/');
    const button = page.getByRole('banner').getByRole('link', { name: 'Dashboard' });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('cell', { name: 'ada@example.com' })).toBeVisible();
    await expect(page.getByText('People', { exact: true })).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await page
      .getByRole('row', { name: /ada@example.com/ })
      .getByRole('button', { name: 'Block' })
      .click();
    await expect
      .poll(() =>
        calls.some((c) => c.fn === 'admin_set_blocked' && c.body.includes('"block":true')),
      )
      .toBe(true);
    // the owner cannot block themselves: no button on their own row
    await expect(
      page.getByRole('row', { name: /owner@example.com/ }).getByRole('button'),
    ).toHaveCount(0);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Users CSV' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^crisper-users-\d{4}-\d{2}-\d{2}\.csv$/);

    await page.getByRole('tab', { name: /Presets/ }).click();
    await page
      .getByRole('row', { name: /Ada neon/ })
      .getByRole('button', { name: 'Hide' })
      .click();
    await expect
      .poll(() =>
        calls.some((c) => c.fn === 'admin_set_preset_hidden' && c.body.includes('"hide":true')),
      )
      .toBe(true);
  });

  test('anyone else sees no button, and the page says it is not for them', async ({ page }) => {
    await fake(page, false);
    await page.goto('/');
    await expect(page.getByRole('banner').getByRole('button', { name: /Account/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
    await page.goto('/admin');
    await expect(page.getByTestId('admin-gate')).toHaveText(
      'This page is only for the owner of Crisper.',
    );
    await expect(page.getByText('ada@example.com')).toHaveCount(0);
  });
});

test.describe('share links', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('a link opens Crisper with that preset, then tidies the address', async ({ page }) => {
    await fake(page, false);
    await page.goto('/?preset=their-preset');
    await expect(page.getByLabel('Active preset')).toHaveValue('their-preset');
    await expect(page.getByText('Using "Ada neon" by Ada.')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('Share copies a link to the selected preset', async ({ page }) => {
    await fake(page, false);
    await page.goto('/');
    await page.getByRole('tab', { name: 'Colors' }).click();
    await page.getByRole('option', { name: /^Mo/ }).filter({ visible: true }).click();
    await page
      .getByRole('button', { name: 'Share', exact: true })
      .filter({ visible: true })
      .click();
    await expect(page.getByText('Link copied.')).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toMatch(/\/\?preset=builtin-mo$/);
  });

  test('a broken link says so', async ({ page }) => {
    await fake(page, false);
    await page.route(`${DB}/rest/v1/presets**`, (route) => route.fulfill({ json: [] }));
    await page.goto('/?preset=gone-123');
    await expect(page.getByText('That preset link no longer works.')).toBeVisible();
  });
});
