import { workbench } from '../ui/workbench.js';
import { openViewer } from '../core/pdf.js';
import { pdfjs } from '../core/lib.js';
import { canvasToBlob, pad, safeName } from '../core/files.js';
import { checkRange, parseRange } from '../core/range.js';
import { stem, plural, bytes as fmtBytes } from '../ui/kit.js';

/**
 * Pulls embedded raster images out of a document.
 *
 * PDF.js exposes decoded images through the page object store once the
 * operator list has been walked, which is what happens here: read the ops,
 * pick out the image paints, and re-encode whatever comes back.
 */
export default function mount(host, tool) {
  let total = 0;

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Extract the images',
    actionIcon: 'extractImages',
    dropTitle: 'Choose a PDF, or drop it here',

    async onFiles(a) {
      total = 0;
      if (!a.files[0]) return;
      const viewer = await openViewer(a.files[0]);
      total = viewer.numPages;
      viewer.destroy();
      a.refreshFields();
    },

    fields: [
      {
        name: 'pages', type: 'pages', label: 'Pages', value: 'all',
        check: (spec) => {
          if (!total) return { ok: true, text: '' };
          const res = checkRange(spec, total);
          return res.ok ? { ok: true, text: `${res.count} of ${total}` } : { ok: false, text: 'unreadable' };
        },
      },
      {
        name: 'format', type: 'segmented', label: 'Save as', value: 'image/png',
        options: [{ value: 'image/png', label: 'PNG' }, { value: 'image/jpeg', label: 'JPG' }, { value: 'image/webp', label: 'WebP' }],
      },
      { name: 'quality', type: 'range', label: 'Quality', value: 92, min: 40, max: 100, step: 1, suffix: '%', when: (v) => v.format !== 'image/png' },
      {
        name: 'minSize', type: 'number', label: 'Ignore images under', value: 64, min: 1, step: 8,
        hint: 'Pixels on the shortest side. Filters out rules, bullets and spacers.',
      },
      { name: 'dedupe', type: 'checkbox', label: 'Skip repeats', value: true, hint: 'A logo on every page is written once.' },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      const res = checkRange(a.values.pages, total || 1);
      return res.ok ? null : res.error;
    },

    async run(a) {
      const pdfjsLib = await pdfjs();
      const OPS = pdfjsLib.OPS;
      const file = a.files[0];
      const viewer = await openViewer(file);
      const v = a.values;
      const wanted = parseRange(v.pages, viewer.numPages);
      const base = safeName(stem(file.name));
      const ext = v.format === 'image/jpeg' ? 'jpg' : v.format === 'image/webp' ? 'webp' : 'png';
      const minSize = Math.max(1, Number(v.minSize) || 1);
      const seen = new Set();
      const outputs = [];

      for (let i = 0; i < wanted.length; i++) {
        const n = wanted[i];
        await a.progress(i / wanted.length, `Page ${n + 1} — found ${outputs.length} so far…`);
        const page = await viewer.getPage(n + 1);
        let ops;
        try { ops = await page.getOperatorList(); } catch { page.cleanup(); continue; }

        const names = [];
        for (let k = 0; k < ops.fnArray.length; k++) {
          const fn = ops.fnArray[k];
          if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintImageXObjectRepeat) {
            const name = ops.argsArray[k][0];
            if (typeof name === 'string') names.push(name);
          }
        }

        for (const name of Array.from(new Set(names))) {
          if (v.dedupe && seen.has(name)) continue;
          const img = await getImage(page, name);
          if (!img) continue;
          const w = img.width, hgt = img.height;
          if (!w || !hgt || Math.min(w, hgt) < minSize) continue;
          if (v.dedupe) seen.add(name);

          const canvas = toCanvas(img);
          if (!canvas) continue;
          const blob = await canvasToBlob(canvas, v.format, v.format === 'image/png' ? undefined : v.quality / 100);
          canvas.width = canvas.height = 0;
          if (!blob) continue;
          outputs.push({
            name: `${base}-p${pad(n + 1, viewer.numPages)}-${pad(outputs.length + 1, 999)}.${ext}`,
            blob,
            note: `${w} × ${hgt} px`,
          });
        }
        page.cleanup();
      }

      viewer.destroy();
      if (!outputs.length) throw new Error('No embedded images were found. Pages that only contain text or vector art have none — use PDF to images to rasterise them instead.');

      const totalBytes = outputs.reduce((s, o) => s + o.blob.size, 0);
      await a.done(outputs, { zipName: `${base}-images.zip` });
      a.status(`${plural(outputs.length, 'image')} · ${fmtBytes(totalBytes)}`);
    },
  });
}

/** The object store resolves asynchronously; give up rather than hang. */
function getImage(page, name) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };
    setTimeout(() => finish(null), 8000);
    try {
      if (page.objs.has?.(name)) { finish(page.objs.get(name)); return; }
      page.objs.get(name, finish);
    } catch { finish(null); }
  });
}

function toCanvas(img) {
  const width = img.width;
  const height = img.height;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (img.bitmap) { ctx.drawImage(img.bitmap, 0, 0); return canvas; }
  if (!img.data) return null;

  const out = ctx.createImageData(width, height);
  const src = img.data;
  const channels = src.length / (width * height);

  if (channels >= 4) {
    out.data.set(src.subarray(0, width * height * 4));
  } else if (channels === 3) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out.data[i * 4] = src[j];
      out.data[i * 4 + 1] = src[j + 1];
      out.data[i * 4 + 2] = src[j + 2];
      out.data[i * 4 + 3] = 255;
    }
  } else if (channels === 1) {
    for (let i = 0; i < width * height; i++) {
      const g = src[i];
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = g;
      out.data[i * 4 + 3] = 255;
    }
  } else {
    return null;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
