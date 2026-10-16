// Puts the text-recognition files in public/ocr, so the browser loads them from this site
// (nothing is fetched from a third party, and the screenshot never leaves the browser).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const out = path.join(root, 'public', 'ocr');
mkdirSync(path.join(out, 'lang'), { recursive: true });

const tesseractDir = path.dirname(require.resolve('tesseract.js/package.json'));
const coreDir = path.dirname(
  createRequire(path.join(tesseractDir, 'package.json')).resolve('tesseract.js-core/package.json'),
);
const langDir = path.join(
  path.dirname(require.resolve('@tesseract.js-data/eng/package.json')),
  '4.0.0_best_int',
);

const files = [
  [path.join(tesseractDir, 'dist', 'worker.min.js'), path.join(out, 'worker.min.js')],
  ...['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm'].map(
    (n) => [path.join(coreDir, `${n}.wasm.js`), path.join(out, `${n}.wasm.js`)],
  ),
  [path.join(langDir, 'eng.traineddata.gz'), path.join(out, 'lang', 'eng.traineddata.gz')],
];
for (const [from, to] of files) {
  if (!existsSync(from)) throw new Error(`Missing text recognition file: ${from}`);
  if (!existsSync(to)) copyFileSync(from, to);
}
console.log(`Text recognition files ready in ${path.relative(root, out)}`);
