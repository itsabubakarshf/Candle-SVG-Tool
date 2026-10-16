# Tests

## Figma paste check (manual)

`figma-paste-test.svg` is a tiny SVG with named groups and children, built like the real export.

1. Open the file in a text editor and copy all of its text (Ctrl+A, Ctrl+C).
2. Click the Figma canvas and press Ctrl+V.
3. Look at the Layers panel. Write down the names you see.

Expected: `Candle 01` and `Candle 02` groups, each holding `Upper wick`, `Lower wick`, `Body`.
If the children show as `Line` / `Rectangle` instead, the tool will name only the groups.
