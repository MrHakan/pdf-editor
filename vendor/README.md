# Vendored libraries

Quire loads no code from a CDN. Everything the tools need lives here and is
served from the same origin as the page, which is what lets the app keep
working with the network switched off — and what makes "nothing leaves this
device" checkable rather than promised.

| File | Package | Version | Licence |
| --- | --- | --- | --- |
| `pdf-lib.esm.min.js` | [`@cantoo/pdf-lib`](https://www.npmjs.com/package/@cantoo/pdf-lib) | 2.8.1 | MIT — `LICENSE-pdf-lib.md` |
| `fontkit.esm.js` | [`fontkit`](https://www.npmjs.com/package/fontkit) | 2.0.4 | MIT — `LICENSE-fontkit` |
| `jszip.min.js` | [`jszip`](https://www.npmjs.com/package/jszip) | 3.10.1 | MIT / GPLv3 |
| `pdfjs/` | [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) | 4.10.38 | Apache-2.0 — `LICENSE-pdfjs` |
| `tesseract/` | [`tesseract.js`](https://www.npmjs.com/package/tesseract.js) 5.1.1, [`tesseract.js-core`](https://www.npmjs.com/package/tesseract.js-core) 5.x, [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) | — | Apache-2.0 |

All but one file is copied straight out of its published package.

## The one build step

`fontkit.esm.js` is the exception. The published ESM build imports `pako` as a
bare specifier and `fs` from Node, neither of which a browser can resolve, so it
is bundled once and committed:

```sh
npm install fontkit@2.0.4 esbuild

cat > fk-entry.mjs <<'EOF'
import * as fontkit from 'fontkit';
export default fontkit;
export * from 'fontkit';
EOF

# fontkit's Node-only file loader is unreachable in a browser build.
cat > fs-shim.js <<'EOF'
const missing = () => { throw new Error('File system access is not available in the browser.'); };
export const readFileSync = missing;
export const openSync = missing;
export const readSync = missing;
export const closeSync = missing;
export const fstatSync = missing;
export default { readFileSync, openSync, readSync, closeSync, fstatSync };
EOF

npx esbuild fk-entry.mjs --bundle --format=esm --minify \
  --platform=browser --target=es2020 --alias:fs=./fs-shim.js \
  --outfile=vendor/fontkit.esm.js
```

## Updating a library

Replace the file, run the tool suite against a real document, and check the
version in the table above. `pdfjs/cmaps` and `pdfjs/standard_fonts` must be
updated alongside `pdfjs/pdf.min.mjs` — a mismatch shows up as missing glyphs
in CJK documents rather than as an error.

The Tesseract language models are gzipped `tessdata_fast` files. To add a
language, drop `<code>.traineddata.gz` into `tesseract/lang/` and add it to the
list in `src/tools/ocr.js`.

`tesseract/core/` holds the two `*-lstm.wasm.js` builds — the SIMD one and the
plain fallback, picked at runtime by feature detection. These are the variants
with the WebAssembly embedded; the separate `.js` + `.wasm` pairs in the package
are not what the worker asks for and will 404 if you ship those instead.
