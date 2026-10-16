import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  SAMPLE,
  candleGroups,
  copiedSvg,
  decodePng,
  loadBuffer,
  loadSample,
  pngBuffer,
  pngOf,
  simpleChart,
} from './helpers';
import {
  HOLLOW_STYLE,
  copyImage,
  layout,
  overlayLine,
  overlayText,
  renderChart,
} from '../tests/synth/generate';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('loading a screenshot', () => {
  test('empty state offers paste, drop or click, and Copy SVG is off', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Crisper');
    await expect(page.getByRole('heading', { name: 'Crisper', level: 1 })).toBeVisible();
    await expect(page.getByText('Paste (Ctrl+V), drop, or click to upload.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy SVG' }).first()).toBeDisabled();
  });

  test('upload detects the 5 candles of the real sample with the right types (AC-1)', async ({
    page,
  }) => {
    await loadSample(page);
    await expect(page.locator('[data-candle]')).toHaveCount(5);
    const rows = page.getByRole('region', { name: 'Candles' }).getByRole('button');
    await expect(rows).toHaveCount(5);
    const types = await rows.evaluateAll((els) =>
      els.map((e) => /(bull|bear)/.exec(e.textContent ?? '')?.[1]),
    );
    expect(types).toEqual(['bull', 'bull', 'bear', 'bear', 'bull']);
    await expect(page.getByTestId('measured-border-width')).toHaveText('1.00 px');
    await expect(page.getByTestId('measured-body-width')).toHaveText('45.00 px');
  });

  test('the drawn SVG lines up with the screenshot pixel for pixel (AC-1)', async ({ page }) => {
    await loadSample(page);
    const slider = page.getByRole('slider', { name: 'SVG opacity' });
    const content = page.getByTestId('content');
    await slider.focus();
    await page.keyboard.press('Home'); // overlay invisible: screenshot only
    const shot = decodePng(await content.screenshot());
    await page.keyboard.press('End'); // overlay fully opaque
    await page.getByRole('switch', { name: 'Show screenshot' }).click();
    const overlay = decodePng(await content.screenshot());
    expect([overlay.width, overlay.height]).toEqual([shot.width, shot.height]);
    let mismatched = 0;
    let ink = 0;
    for (let i = 0; i < shot.data.length; i += 4) {
      const a = (shot.data[i]! + shot.data[i + 1]! + shot.data[i + 2]!) / 3 < 150;
      const b = (overlay.data[i]! + overlay.data[i + 1]! + overlay.data[i + 2]!) / 3 < 150;
      if (a) ink++;
      if (a !== b) mismatched++;
    }
    expect(ink).toBeGreaterThan(5000);
    expect(mismatched / ink).toBeLessThan(0.01);
  });

  test('paste works anywhere on the page', async ({ page }) => {
    await page.goto('/');
    const b64 = fs.readFileSync(SAMPLE).toString('base64');
    await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
      document.body.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    }, b64);
    await expect(page.getByTestId('candle-count')).toHaveText('5 candles');
  });

  test('drag and drop works', async ({ page }) => {
    await page.goto('/');
    const b64 = fs.readFileSync(SAMPLE).toString('base64');
    await page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
      document
        .querySelector('[role=button]')!
        .dispatchEvent(
          new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }),
        );
    }, b64);
    await expect(page.getByTestId('candle-count')).toHaveText('5 candles');
  });

  test('an unsupported file gets a clear error', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('input[type=file]', {
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    });
    await expect(
      page.getByText('Unsupported file. Use a PNG, JPG or WEBP image.').first(),
    ).toBeVisible();
  });

  test('an image with no candles gets a clear error and nothing to copy', async ({ page }) => {
    const blank = pngBuffer({ width: 120, height: 120, candles: [], style: HOLLOW_STYLE });
    await loadBuffer(page, blank, 'blank.png');
    await expect(page.getByRole('alert').filter({ hasText: 'No candles found' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy SVG' }).first()).toBeDisabled();
  });

  test('New clears the screenshot', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('button', { name: 'New' }).click();
    await expect(page.getByText('Paste (Ctrl+V), drop, or click to upload.')).toBeVisible();
  });
});

test.describe('privacy and responsiveness (NFR-3, NFR-4)', () => {
  test('detection runs in a Web Worker and nothing leaves the browser', async ({ page }) => {
    const outbound: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (r.method() !== 'GET' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
        if (!url.protocol.startsWith('data') && !url.protocol.startsWith('blob'))
          outbound.push(`${r.method()} ${r.url()}`);
      }
    });
    await loadSample(page);
    await page.getByRole('button', { name: 'Copy SVG' }).first().click();
    expect(page.workers().length).toBeGreaterThan(0);
    expect(outbound).toEqual([]);
  });
});

test.describe('copy and export (AC-3, AC-4)', () => {
  test('Copy SVG puts named vector layers on the clipboard', async ({ page }) => {
    await loadSample(page);
    const svg = await copiedSvg(page);
    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="282" height="547" viewBox="0 0 282 547">',
      ),
    ).toBe(true);
    const groups = candleGroups(svg);
    expect(groups.length).toBe(5);
    expect(groups.map((g) => g.split('"')[0])).toEqual([
      'Candle 01',
      'Candle 02',
      'Candle 03',
      'Candle 04',
      'Candle 05',
    ]);
    for (const g of groups) {
      expect(g).toContain('id="Upper wick"');
      expect(g).toContain('id="Lower wick"');
      expect(g).toContain('id="Body"');
    }
    for (const bad of ['<style', 'class=', 'transform', 'filter', 'vector-effect']) {
      expect(svg).not.toContain(bad);
    }
  });

  test('Ctrl+C copies the SVG when nothing is being edited', async ({ page }) => {
    await loadSample(page);
    await page.keyboard.press('Control+c');
    await expect(page.getByText('SVG copied. Paste in Figma with Ctrl+V.').first()).toBeVisible();
    const svg = await page.evaluate(() => navigator.clipboard.readText());
    expect(svg).toContain('id="Candle 01"');
  });

  test('Download SVG saves a file', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('tab', { name: 'Export' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download SVG' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    const text = fs.readFileSync((await download.path())!, 'utf8');
    expect(text).toContain('id="Candle 05"');
  });

  test('Download PNG renders at 2x, 3x and 4x', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('tab', { name: 'Export' }).click();
    for (const scale of [2, 3, 4]) {
      await page.getByRole('radio', { name: `${scale}x` }).click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Download PNG' }).click(),
      ]);
      expect(download.suggestedFilename()).toContain(`@${scale}x.png`);
      const png = decodePng(fs.readFileSync((await download.path())!));
      expect([png.width, png.height]).toEqual([282 * scale, 547 * scale]);
    }
  });

  test('the background switch adds a rect named Background', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('tab', { name: 'Export' }).click();
    expect(await copiedSvg(page)).not.toContain('Background');
    await page.getByRole('switch', { name: 'Background rectangle' }).click();
    const svg = await copiedSvg(page);
    expect(svg).toContain('<rect id="Background"');
    expect(svg.indexOf('Background')).toBeLessThan(svg.indexOf('Candle 01'));
  });
});

test.describe('editing (AC-6, AC-7)', () => {
  test('flipping one candle changes only that candle, in preview and export', async ({ page }) => {
    await loadSample(page);
    const before = candleGroups(await copiedSvg(page));
    await page.getByTestId('hit-2').click({ position: { x: 22, y: 100 } });
    await page.keyboard.press('t');
    const after = candleGroups(await copiedSvg(page));
    expect(after[1]).not.toEqual(before[1]);
    // bull -> bear: it now looks like the chart's other bear candles (same fill as candle 3)
    const fillOf = (g: string) => /id="Body"[^>]*fill="(#[0-9A-F]{6})"/.exec(g)![1];
    expect(fillOf(after[1]!)).toBe(fillOf(before[2]!));
    expect(fillOf(before[1]!)).not.toBe(fillOf(before[2]!));
    for (const i of [0, 2, 3, 4]) expect(after[i]).toEqual(before[i]);
    // the preview changed too
    await expect(page.getByRole('button', { name: 'bear', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('colour override applies to one candle and Reset to preset removes it', async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('hit-1').click({ position: { x: 22, y: 100 } });
    await page.getByLabel('Body fill', { exact: true }).fill('#FF0000');
    let groups = candleGroups(await copiedSvg(page));
    expect(groups[0]).toContain('fill="#FF0000"');
    expect(groups.slice(1).join('')).not.toContain('#FF0000');
    await page.getByRole('button', { name: 'Reset to preset' }).click();
    groups = candleGroups(await copiedSvg(page));
    expect(groups.join('')).not.toContain('#FF0000');
  });

  test('delete and undo/redo', async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('hit-3').click({ position: { x: 22, y: 100 } });
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('canvas-count')).toHaveText('4 candles');
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('canvas-count')).toHaveText('5 candles');
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByTestId('canvas-count')).toHaveText('4 candles');
  });

  test('Shift+click selects several candles and Esc clears', async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('hit-1').click({ position: { x: 22, y: 100 } });
    await page.getByTestId('hit-2').click({ position: { x: 22, y: 100 }, modifiers: ['Shift'] });
    await expect(page.getByText('2 candles selected')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByText('Click a candle on the canvas to edit it.', { exact: false }),
    ).toBeVisible();
  });

  test('dragging a handle moves the edge, in 0.5 px steps, and undo puts it back', async ({
    page,
  }) => {
    await loadSample(page);
    await page.getByTestId('hit-1').click({ position: { x: 22, y: 100 } });
    const top = page.getByLabel('Body top');
    await expect(top).toHaveValue('362');
    const handle = page.getByTestId('handle-bodyTop');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 10, { steps: 4 });
    await page.mouse.up();
    await expect(top).toHaveValue('372');
    await page.keyboard.press('Control+z');
    await expect(top).toHaveValue('362');
  });

  test('arrow keys nudge the active handle by 0.5 px (0.1 with Shift)', async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('hit-1').click({ position: { x: 22, y: 100 } });
    const handle = page.getByTestId('handle-bodyBottom');
    const box = (await handle.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const bottom = page.getByLabel('Body bottom');
    await expect(bottom).toHaveValue('387');
    await page.keyboard.press('ArrowDown');
    await expect(bottom).toHaveValue('387.5');
    await page.keyboard.press('Shift+ArrowUp');
    await expect(bottom).toHaveValue('387.4');
  });

  test('edge numbers can be typed', async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('hit-1').click({ position: { x: 22, y: 100 } });
    const wick = page.getByLabel('Wick top');
    await wick.fill('180.25');
    await wick.press('Enter');
    const svg = await copiedSvg(page);
    expect(svg).toContain('y1="180.25"');
  });

  test('split cuts a candle where you clicked and Merge puts it back', async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('hit-1').click({ position: { x: 22, y: 100 } });
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(page.getByTestId('canvas-count')).toHaveText('6 candles');
    await expect(page.getByText('2 candles selected')).toBeVisible();
    await page.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(page.getByTestId('canvas-count')).toHaveText('5 candles');
  });

  test('left and right arrows move through the candles', async ({ page }) => {
    await loadSample(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('selected-1')).toHaveCount(1);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('selected-2')).toHaveCount(1);
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('selected-1')).toHaveCount(1);
  });
});

test.describe('review flags (AC-8)', () => {
  test('a candle that is much wider than the rest gets an amber flag', async ({ page }) => {
    await loadBuffer(page, pngBuffer(simpleChart([21, 21, 21, 43])));
    await expect(page.getByTestId('candle-count')).toHaveText('4 candles');
    await expect(page.getByTestId('flag-4')).toBeAttached();
    await expect(page.getByTestId('flag-1')).toHaveCount(0);
    await expect(page.getByTestId('flagged-count')).toContainText('1 flagged');
  });
});

test.describe('detection settings (FR-18)', () => {
  test('changing a setting re-detects, and undo brings the earlier result back', async ({
    page,
  }) => {
    await loadBuffer(page, pngBuffer(simpleChart([21, 25, 23])));
    await expect(page.getByTestId('candle-count')).toHaveText('3 candles');
    const uniform = page.getByRole('switch', { name: 'Uniform body width' });
    await expect(uniform).toBeChecked();
    const widthsOn = candleGroups(await copiedSvg(page)).map(
      (g) => /width="([\d.]+)"/.exec(g.split('id="Body"')[1]!)![1],
    );
    expect(new Set(widthsOn).size).toBe(1);
    await uniform.click();
    await expect(uniform).not.toBeChecked();
    await expect
      .poll(async () => {
        const w = candleGroups(await copiedSvg(page)).map(
          (g) => /width="([\d.]+)"/.exec(g.split('id="Body"')[1]!)![1],
        );
        return new Set(w).size;
      })
      .toBeGreaterThan(1);
  });
});

test.describe('presets (AC-5)', () => {
  test('a saved custom preset is still active after reloading the page', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('tab', { name: 'Colors' }).click();
    await page.getByTitle('New preset').click();
    await page.getByLabel('Name', { exact: true }).fill('E2E preset');
    await page
      .getByRole('group', { name: 'bull' })
      .getByLabel('Border', { exact: true })
      .fill('#FF00AA');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByLabel('Active preset').locator('option:checked')).toHaveText(
      'E2E preset',
    );

    await page.reload();
    await expect(page.getByLabel('Active preset').locator('option:checked')).toHaveText(
      'E2E preset',
    );
    await page.setInputFiles('input[type=file]', SAMPLE);
    await expect(page.getByTestId('candle-count')).toHaveText('5 candles');
    const svg = await copiedSvg(page);
    expect(svg).toContain('stroke="#FF00AA"');
  });

  test('colour changes show live in the preview before saving, and Revert undoes them', async ({
    page,
  }) => {
    await loadSample(page);
    await page.getByLabel('Active preset').selectOption({ label: 'Light' });
    await page.getByRole('tab', { name: 'Colors' }).click();
    await page
      .getByRole('group', { name: 'bull' })
      .getByLabel('Body fill', { exact: true })
      .fill('#00FF00');
    const bodyFill = () =>
      page.locator('[data-candle="Candle 01"] rect').first().getAttribute('fill');
    await expect.poll(bodyFill).toBe('#00FF00');
    await page.getByRole('button', { name: 'Revert' }).click();
    await expect.poll(bodyFill).toBe('#FFFFFF');
  });

  test('built-ins cannot be deleted; switching to Dark changes the export', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('tab', { name: 'Colors' }).click();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await page.getByLabel('Active preset').selectOption({ label: 'Dark' });
    const svg = await copiedSvg(page);
    expect(svg).toContain('#E6E8EC');
    expect(svg).not.toContain('#2B2F36');
  });

  test('exports and re-imports a backup file', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Colors' }).click();
    await page.getByTitle('New preset').click();
    await page.getByLabel('Name', { exact: true }).fill('Backup me');
    await page.getByRole('button', { name: 'Save' }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export' }).click(),
    ]);
    const file = (await download.path())!;
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).presets[0].name).toBe('Backup me');
    page.once('dialog', (d) => void d.dismiss()); // "keep both"
    await page.getByLabel('Import presets JSON file').setInputFiles(file);
    await expect(
      page.getByLabel('Active preset').locator('option', { hasText: 'Backup me 2' }),
    ).toHaveCount(1);
  });
});

test.describe('Original colours: the chart keeps the colours it was uploaded with', () => {
  // The real colours in the sample screenshot (read from its pixels)
  const BULL_FILL = '#FCFCFE';
  const BEAR_FILL = '#262F34';
  const LINE = '#393939';

  test('is the default, and the SVG uses the screenshot colours, not ours', async ({ page }) => {
    await loadSample(page);
    await expect(page.getByLabel('Active preset').locator('option:checked')).toHaveText(
      'Original colors',
    );
    const svg = await copiedSvg(page);
    expect(svg).toContain(`fill="${BULL_FILL}" stroke="${LINE}"`);
    expect(svg).toContain(`fill="${BEAR_FILL}" stroke="${LINE}"`);
    expect(svg).not.toContain('#2B2F36'); // the Light preset's colour never appears
    expect(svg).not.toContain('fill="#FFFFFF"');
  });

  test('a chart in any other colours keeps them', async ({ page }) => {
    const style = {
      background: [255, 255, 255] as [number, number, number],
      bull: {
        fill: [255, 214, 10] as [number, number, number],
        border: [122, 92, 0] as [number, number, number],
        wick: [122, 92, 0] as [number, number, number],
      },
      bear: {
        fill: [91, 42, 134] as [number, number, number],
        border: [46, 18, 69] as [number, number, number],
        wick: [46, 18, 69] as [number, number, number],
      },
      borderWidth: 2,
      wickWidth: 1,
    };
    const specs = [0, 1, 2, 3].map((i) => ({
      type: (i % 2 ? 'bear' : 'bull') as 'bull' | 'bear',
      bodyTop: 100 + i * 8,
      bodyBottom: 170 + i * 4,
      wickTop: 70,
      wickBottom: 200,
      bodyWidth: 25,
    }));
    await loadBuffer(
      page,
      pngBuffer(layout(specs, { style, pitch: 40, height: 260 })),
      'purple-yellow.png',
    );
    await expect(page.getByTestId('canvas-count')).toHaveText('4 candles');
    const svg = await copiedSvg(page);
    for (const hex of ['#FFD60A', '#7A5C00', '#5B2A86', '#2E1245']) expect(svg).toContain(hex);
    expect(svg).toContain('stroke-width="2"'); // the chart's own border width too
  });

  test('the Colors tab shows what was found, and presets are one click away', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('tab', { name: 'Colors' }).click();
    const found = page.getByTestId('original-colours');
    await expect(found).toContainText(BULL_FILL);
    await expect(found).toContainText(BEAR_FILL);
    await expect(found).toContainText(LINE);
    // pick a preset: the SVG is restyled; pick Original again: the chart's colours return
    await page.getByLabel('Active preset').selectOption({ label: 'Light' });
    let svg = await copiedSvg(page);
    expect(svg).toContain('#2B2F36');
    expect(svg).not.toContain(BULL_FILL);
    await page.getByLabel('Active preset').selectOption({ label: 'Original colors' });
    svg = await copiedSvg(page);
    expect(svg).toContain(BULL_FILL);
    expect(svg).not.toContain('#2B2F36');
  });

  test('the choice is remembered; a new visitor starts on Original colours', async ({
    page,
    browser,
  }) => {
    await loadSample(page);
    await page.getByLabel('Active preset').selectOption({ label: 'Dark' });
    await page.reload();
    await expect(page.getByLabel('Active preset').locator('option:checked')).toHaveText('Dark');
    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    await other.goto('/');
    await expect(other.getByLabel('Active preset').locator('option:checked')).toHaveText(
      'Original colors',
    );
    await fresh.close();
  });

  test('"Save as preset" keeps the chart\'s colours as a preset you can edit', async ({ page }) => {
    await loadSample(page);
    await page.getByRole('tab', { name: 'Colors' }).click();
    await page.getByRole('button', { name: 'Save as preset' }).click();
    await expect(page.getByLabel('Active preset').locator('option:checked')).toHaveText(
      'From screenshot',
    );
    // it is a normal preset now: editable, with the chart's colours in it
    await expect(
      page.getByRole('group', { name: 'bull' }).getByLabel('Body fill', { exact: true }),
    ).toHaveValue(BULL_FILL);
    await page
      .getByRole('group', { name: 'bull' })
      .getByLabel('Body fill', { exact: true })
      .fill('#00FF00');
    await page.getByRole('button', { name: 'Save' }).click();
    expect(await copiedSvg(page)).toContain('fill="#00FF00"');
  });

  test("flipping a candle gives it the chart's colours for the other type", async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('hit-1').click({ position: { x: 22, y: 100 } });
    await page.keyboard.press('t'); // candle 1: bull -> bear
    const groups = candleGroups(await copiedSvg(page));
    expect(groups[0]).toContain(`fill="${BEAR_FILL}"`);
    expect(groups[0]).not.toContain(BULL_FILL);
  });
});

test.describe('canvas (FR-8, FR-19)', () => {
  test('scroll zooms and Space + drag pans', async ({ page }) => {
    await loadSample(page);
    const viewport = page.getByTestId('viewport');
    const box = (await viewport.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const zoomLabel = page.getByRole('button', { name: /^Zoom \d+ percent/ });
    await expect(zoomLabel).toHaveText('100%');
    await page.mouse.wheel(0, -400);
    await expect
      .poll(async () => Number.parseInt((await zoomLabel.textContent()) ?? '0'))
      .toBeGreaterThan(100);

    const content = page.getByTestId('content');
    const before = (await content.boundingBox())!;
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    const after = (await content.boundingBox())!;
    expect(Math.round(after.x - before.x)).toBe(60);
    expect(Math.round(after.y - before.y)).toBe(40);
    await expect(page.getByTestId('canvas-count')).toHaveText('5 candles'); // panning did not select or edit
  });

  test('zoom buttons and fit work, and the overlay stays aligned at 400%', async ({ page }) => {
    await loadSample(page);
    const zoomLabel = page.getByRole('button', { name: /^Zoom \d+ percent/ });
    for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
    const percent = Number.parseInt((await zoomLabel.textContent()) ?? '0');
    expect(percent).toBeGreaterThanOrEqual(400);
    // wick of candle 1 is at x = 24.5 in the image; overlay and image must agree
    const content = page.getByTestId('content');
    const box = (await content.boundingBox())!;
    const line = page.locator('[data-candle="Candle 01"] line').first();
    const lbox = (await line.boundingBox())!;
    const scale = box.width / 282;
    expect(lbox.x + lbox.width / 2 - box.x).toBeCloseTo(24.5 * scale, 0);
    await page.getByRole('button', { name: 'Fit to screen' }).click();
    const fitted = Number.parseInt((await zoomLabel.textContent()) ?? '0');
    expect(fitted).toBeGreaterThan(100); // small image: fit fills the view
    await zoomLabel.click();
    await expect(zoomLabel).toHaveText('100%');
  });

  test('opacity slider and Show screenshot toggle work', async ({ page }) => {
    await loadSample(page);
    const slider = page.getByRole('slider', { name: 'SVG opacity' });
    await slider.focus();
    await page.keyboard.press('Home');
    await expect(page.getByTestId('overlay-shapes')).toHaveAttribute('opacity', '0');
    await page.keyboard.press('End');
    await expect(page.getByTestId('overlay-shapes')).toHaveAttribute('opacity', '1');
    const img = page.getByAltText('Uploaded candle screenshot');
    await page.getByRole('switch', { name: 'Show screenshot' }).click();
    await expect(img).toHaveCSS('opacity', '0');
    await page.getByRole('switch', { name: 'Show screenshot' }).click();
    await expect(img).toHaveCSS('opacity', '1');
  });
});

test.describe('shortcuts and help', () => {
  test('? shows the shortcut list and Esc closes it', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('?');
    await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeHidden();
  });

  test('typing in a field does not trigger shortcuts', async ({ page }) => {
    await loadSample(page);
    await page.getByTestId('hit-1').click({ position: { x: 22, y: 100 } });
    await page.getByLabel('Wick top').focus();
    await page.keyboard.type('t');
    await page.keyboard.press('Backspace');
    await expect(page.getByTestId('canvas-count')).toHaveText('5 candles');
    await expect(page.getByRole('button', { name: 'bull', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('device scaling (NFR-6, AC-2)', () => {
  for (const dpr of [1, 1.25, 1.5, 2]) {
    test.describe(`device pixel ratio ${dpr}`, () => {
      test.use({ deviceScaleFactor: dpr });
      test('the screenshot is drawn at exactly one source pixel per screen pixel', async ({
        page,
      }) => {
        await loadSample(page);
        const box = (await page.getByAltText('Uploaded candle screenshot').boundingBox())!;
        expect(box.width * dpr).toBeCloseTo(282, 0);
        expect(box.height * dpr).toBeCloseTo(547, 0);
        const groups = candleGroups(await copiedSvg(page));
        expect(groups.length).toBe(5); // same result at every scaling
      });
    });
  }
});

test.describe('look and layout (NFR-8)', () => {
  test.describe('dark system setting', () => {
    test.use({ colorScheme: 'dark' });
    test('follows the system dark setting by default', async ({ page }) => {
      await loadSample(page);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe('rgb(14, 16, 19)');
    });

    test('the Light theme switch gives a white app even when the system is dark', async ({
      page,
    }) => {
      await page.goto('/');
      await page.getByRole('radio', { name: 'Light theme' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        'rgb(255, 255, 255)',
      );
      // and the choice is remembered, with no flash of the dark theme on reload
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.getByRole('radio', { name: 'Light theme' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await page.getByRole('radio', { name: 'Match system theme' }).click();
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        'rgb(14, 16, 19)',
      );
    });
  });

  test('the Dark theme switch works on a light system and is remembered', async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    );
    await page.getByRole('radio', { name: 'Dark theme' }).click();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(14, 16, 19)',
    );
    await page.reload();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(14, 16, 19)',
    );
  });

  test('light mode uses a white page', async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(255, 255, 255)',
    );
  });

  test.describe('small screens', () => {
    test.use({ viewport: { width: 800, height: 1000 } });
    test('stack the canvas above the side panel with no sideways scroll', async ({ page }) => {
      await loadSample(page);
      const main = (await page.locator('main').boundingBox())!;
      const aside = (await page.getByRole('complementary', { name: 'Settings' }).boundingBox())!;
      expect(aside.y).toBeGreaterThanOrEqual(main.y + main.height - 2);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  });

  test('controls have accessible names and a visible focus ring', async ({ page }) => {
    await loadSample(page);
    for (const name of [
      'Zoom in',
      'Zoom out',
      'Fit to screen',
      'Keyboard shortcuts',
      'Active preset',
    ]) {
      await expect(
        page.getByRole('button', { name }).or(page.getByLabel(name)).first(),
      ).toBeVisible();
    }
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '';
      const cs = getComputedStyle(el);
      return `${cs.outlineStyle}|${cs.boxShadow}`;
    });
    expect(outline).not.toBe('none|none');
  });
});

test.describe('chart cleanliness', () => {
  const UNCLEAN = 'This chart is not clean';
  const warnings = (page: Page) => page.locator('[data-sonner-toast]').filter({ hasText: UNCLEAN });

  test('a clean chart gets no warning, whatever its colours', async ({ page }) => {
    await loadSample(page);
    await expect(page.getByText('5 candles found').first()).toBeVisible();
    await expect(warnings(page)).toHaveCount(0);
    await expect(page.getByTestId('unclean-notice')).toHaveCount(0);
  });

  test('a chart with a line and price labels gets exactly one warning', async ({ page }) => {
    const img = copyImage(renderChart(simpleChart([25, 25, 25, 25, 25])).image);
    overlayLine(img, { x0: 0, y0: 40, x1: img.width, y1: 40, color: [41, 98, 255] });
    ['4523.5', '4518.0', '4512.5'].forEach((t, i) =>
      overlayText(img, t, img.width - 40, 20 + i * 70, { color: [120, 128, 140], scale: 2 }),
    );
    await loadBuffer(page, pngOf(img));
    await expect(warnings(page)).toHaveCount(1);
    await expect(
      page.getByText('Only candles are allowed', { exact: false }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('unclean-notice')).toBeVisible();
    // Re-detecting the same picture does not nag again.
    await page.getByRole('button', { name: 'Re-detect' }).click();
    await expect(warnings(page)).toHaveCount(1);
    // The candles can still be used.
    await expect(page.getByRole('button', { name: 'Copy SVG' }).first()).toBeEnabled();
  });
});

test.describe('large images', () => {
  test('a 40-candle 2000 x 1200 chart is detected without freezing the page', async ({ page }) => {
    const { randomChart } = await import('../tests/synth/generate');
    const chart = { ...randomChart(40, 7, HOLLOW_STYLE, 20, 48), width: 2000, height: 1200 };
    const png = pngBuffer(chart);
    await loadBuffer(page, png, 'big.png');
    await expect(page.getByTestId('candle-count')).toHaveText('40 candles', { timeout: 15000 });
    expect(renderChart(chart).truth.length).toBe(40);
  });
});
