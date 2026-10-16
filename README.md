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

Lines (solid, dashed, dotted, straight or slanted, any colour), shaded boxes and text labels next
to the candles are found too and copied into the SVG as vector shapes: boxes behind the candles,
lines and labels in front (`Boxes`, `Lines` and `Labels` layers). Text is read by an OCR library
that runs in the browser (the files are served by this site, nothing is uploaded). If a label is
read wrongly or not at all, double-click it on the picture and type it. Double-click empty space to
add a label; click a line or box to move, resize, recolour or delete it. All of it is in the
**Extras** tab and undoes like everything else.

If the screenshot has anything besides candles (a line, a box, price numbers, a watermark), Crisper
shows one notice: "This chart is not clean". It looks at where things are, never at colours, so
candles in any colour are fine. The check stays silent when unsure.

In Figma a normal resize keeps wicks and borders thin. The Scale tool (K) scales strokes too.

## Saved presets online

Crisper needs no account. Saving a preset does: the app asks you to sign in with Google or an
emailed link first. Saved presets are shared. Anyone can pick and use any of them, but only the
account that made a preset can change or delete it (the database enforces this with row-level
security). Editing someone else's preset saves a copy that is yours. Only presets are stored,
never screenshots. If the service is off or unreachable the app still works.

Setup: copy `.env.example` to `.env.local` and fill in the Supabase project URL and publishable
key. Without them presets are saved in the browser only. In Supabase:

- Authentication, URL Configuration: set the Site URL to the app's address and add it to the
  redirect URLs, so sign-in links come back to the app.
- Authentication, Sign In / Providers: email is on by default. To offer Google, add a Google
  OAuth client ID and secret there.
- The table is `public.presets (user_id, id, name, owner_name, data, updated_at)`.

Free Supabase projects pause after a week without traffic.

## Develop

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # unit tests (detection accuracy report is printed)
pnpm build:e2e && pnpm e2e   # end-to-end tests against production builds (online presets off and on)
pnpm lint && pnpm typecheck && pnpm format:check
```

The first run of `pnpm e2e` needs a browser: `pnpm exec playwright install chromium`.

## How it works

| Part                                       | Where                                  |
| ------------------------------------------ | -------------------------------------- |
| Candle detection (pure TypeScript, no DOM) | `lib/detect/`                          |
| "Is the chart clean?" check                | `lib/detect/clean.ts`                  |
| SVG output (pure)                          | `lib/svg/`                             |
| Detection runs in a Web Worker             | `workers/detect.worker.ts`             |
| Test charts with known geometry            | `tests/synth/generate.ts`              |
| Presets (saved in `localStorage`)          | `lib/presets/`, `store/presetStore.ts` |

All measurements are in source-image pixels; pixel `i` covers `[i, i + 1]`. The SVG uses the same
coordinates, so proportions match the screenshot exactly.

The product spec is in `SRS.md`.
