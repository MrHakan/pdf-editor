/**
 * Lazy loaders for the vendored libraries.
 *
 * Everything here is served from this origin — there is no CDN in the app, so
 * a tool works the same on a plane as it does online. Each library is fetched
 * the first time a tool actually needs it.
 */

const base = new URL('../../vendor/', import.meta.url);
const once = (fn) => { let p; return () => (p ||= fn()); };

export const pdflib = once(() => import(new URL('pdf-lib.esm.min.js', base).href));

export const jszip = once(async () => {
  if (!window.JSZip) await loadScript(new URL('jszip.min.js', base).href, 'the zip library');
  return window.JSZip;
});

// fontkit ships with bare specifiers and a Node file-system import, neither of
// which a browser can resolve, so vendor/fontkit.esm.js is a prebuilt bundle.
// See vendor/README.md for how it is produced.
export const fontkit = once(async () => {
  const mod = await import(new URL('fontkit.esm.js', base).href);
  return mod.default || mod;
});

function loadScript(src, what) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${what}.`));
    document.head.append(s);
  });
}

export const pdfjs = once(async () => {
  const mod = await import(new URL('pdfjs/pdf.min.mjs', base).href);
  mod.GlobalWorkerOptions.workerSrc = new URL('pdfjs/pdf.worker.min.mjs', base).href;
  return mod;
});

export const pdfjsAssets = {
  cMapUrl: new URL('pdfjs/cmaps/', base).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('pdfjs/standard_fonts/', base).href,
};
