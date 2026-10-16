import { expect, test } from '@playwright/test';
import { loadBuffer, pngBuffer } from './helpers';
import { layout, randomChart, type SynthCandle, type SynthStyle } from '../tests/synth/generate';

const solid = (c: [number, number, number]) => ({ fill: c, border: c, wick: c });
const BLUE_ORANGE: SynthStyle = {
  background: [255, 255, 255],
  bull: solid([41, 98, 255]),
  bear: solid([255, 152, 0]),
  borderWidth: 1,
  wickWidth: 1,
};
const WHITE_RED: SynthStyle = {
  background: [255, 255, 255],
  bull: { fill: [255, 255, 255], border: [60, 60, 60], wick: [60, 60, 60] },
  bear: solid([230, 30, 50]),
  borderWidth: 1,
  wickWidth: 1,
};

/** Three candles with gaps between them: the layout cannot say which colour is rising. */
function unclearChart(style: SynthStyle) {
  const specs: Array<Omit<SynthCandle, 'centerX'>> = [
    { bodyWidth: 20, bodyTop: 120, bodyBottom: 190, wickTop: 90, wickBottom: 230, type: 'bull' },
    { bodyWidth: 20, bodyTop: 260, bodyBottom: 310, wickTop: 240, wickBottom: 340, type: 'bear' },
    { bodyWidth: 20, bodyTop: 100, bodyBottom: 160, wickTop: 80, wickBottom: 200, type: 'bull' },
  ];
  return layout(specs, { style, pitch: 34, height: 400 });
}

test.describe('which colour is rising', () => {
  test('a chart whose layout says it needs no question', async ({ page }) => {
    await loadBuffer(page, pngBuffer(randomChart(10, 3, BLUE_ORANGE)));
    await expect(page.getByTestId('candle-count')).toHaveText('10 candles');
    await expect(page.getByTestId('direction-prompt')).toHaveCount(0);
    await expect(page.getByTestId('direction-why')).toContainText('how the candles line up');
  });

  test("white up and red down (a friend's chart) is understood without asking", async ({
    page,
  }) => {
    await loadBuffer(page, pngBuffer(randomChart(12, 8, WHITE_RED)));
    await expect(page.getByTestId('candle-count')).toHaveText('12 candles');
    await expect(page.getByTestId('direction-prompt')).toHaveCount(0);
    await expect(page.getByTestId('direction-row')).toContainText('Rising');
  });

  test('when it cannot tell, it asks once with a tap, and remembers the answer', async ({
    page,
  }) => {
    const png = pngBuffer(unclearChart(BLUE_ORANGE));
    await loadBuffer(page, png);
    const prompt = page.getByTestId('direction-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('Which colour is a rising candle?');
    await expect(page.getByTestId('direction-why')).toContainText('Not sure');
    const svgBefore = await page.evaluate(() => document.querySelectorAll('[data-candle]').length);
    expect(svgBefore).toBe(3);

    // tap the orange one: the first of the two buttons holds the first candle's colour (blue)
    await prompt
      .getByRole('button', { name: /\d candles? #/ })
      .nth(1)
      .click();
    await expect(prompt).toHaveCount(0);
    await expect(page.getByTestId('direction-why')).toContainText('your choice');

    // the same colours again: no question
    await page.getByRole('button', { name: 'New', exact: true }).first().click();
    await page.setInputFiles('input[type=file]', {
      name: 'again.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(page.getByTestId('candle-count')).toHaveText('3 candles');
    await expect(page.getByTestId('direction-prompt')).toHaveCount(0);
    await expect(page.getByTestId('direction-why')).toContainText('your earlier answer');
  });

  test('the question can be skipped, and Swap fixes a wrong guess any time', async ({ page }) => {
    await loadBuffer(page, pngBuffer(unclearChart(BLUE_ORANGE)));
    const prompt = page.getByTestId('direction-prompt');
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: /Skip/ }).click();
    await expect(prompt).toHaveCount(0);

    const row = page.getByTestId('direction-row');
    const rising = page.getByTestId('rising-colour');
    const before = await rising.innerText();
    await row.getByRole('button', { name: 'Swap' }).click();
    await expect(rising).not.toHaveText(before);
    // and the swap is one undo step
    await page.keyboard.press('Control+z');
    await expect(rising).toHaveText(before);
  });
});
