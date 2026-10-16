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

async function fakeDatabase(page: Page, opts: { google?: boolean } = {}): Promise<Fake> {
  const fake: Fake = { writes: [], authCalls: [] };
  await page.route(`${DB}/rest/v1/presets**`, async (route) => {
    const r = route.request();
    if (r.method() === 'GET') {
      await route.fulfill({ json: [SHARED_ROW] });
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
