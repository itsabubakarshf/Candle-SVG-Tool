# Crisper

Turns a cropped TradingView candle screenshot into a clean, resizable, Figma-ready SVG that
keeps every candle's exact position, size and spacing.

Everything runs in the browser. Images and presets never leave your machine.

## Use it

1. Paste (Ctrl+V), drop or pick a screenshot with only the candles on a plain background.
2. Check the SVG drawn over the screenshot. Amber dots mark candles worth a second look.
3. Fix anything wrong: click a candle, flip it (T), recolour it, drag its edges, split or merge.
4. Press **Copy SVG** and paste into Figma with Ctrl+V. Candles arrive as named vector layers
   (`Candle 01` → `Upper wick`, `Lower wick`, `Body`).

In Figma a normal resize keeps wicks and borders thin. The Scale tool (K) scales strokes too.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # unit tests (detection accuracy report is printed)
pnpm build && pnpm e2e   # end-to-end tests against the production build
pnpm lint && pnpm typecheck && pnpm format:check
```

The first run of `pnpm e2e` needs a browser: `pnpm exec playwright install chromium`.

## How it works

| Part                                       | Where                                  |
| ------------------------------------------ | -------------------------------------- |
| Candle detection (pure TypeScript, no DOM) | `lib/detect/`                          |
| SVG output (pure)                          | `lib/svg/`                             |
| Detection runs in a Web Worker             | `workers/detect.worker.ts`             |
| Test charts with known geometry            | `tests/synth/generate.ts`              |
| Presets (saved in `localStorage`)          | `lib/presets/`, `store/presetStore.ts` |

All measurements are in source-image pixels; pixel `i` covers `[i, i + 1]`. The SVG uses the same
coordinates, so proportions match the screenshot exactly.

The product spec is in `SRS.md`.
