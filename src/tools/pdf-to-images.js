import { workbench } from '../ui/workbench.js';
import { openViewer, renderPage } from '../core/pdf.js';
import { canvasToBlob, pad, safeName } from '../core/files.js';
import { checkRange, parseRange } from '../core/range.js';
import { stem, plural, bytes as fmtBytes } from '../ui/kit.js';

export default function mount(host, tool) {
  let total = 0;

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Render the images',
    actionIcon: 'pdfToImages',
    dropTitle: 'Choose a PDF, or drop it here',

    async onFiles(a) {
      total = 0;
      if (!a.files[0]) return;
      const doc = await openViewer(a.files[0]);
      total = doc.numPages;
      doc.destroy();
      a.status(`${plural(total, 'page')} ready`);
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
        name: 'format', type: 'segmented', label: 'Format', value: 'image/png',
        options: [
          { value: 'image/png', label: 'PNG', title: 'Lossless, larger files' },
          { value: 'image/jpeg', label: 'JPG', title: 'Smaller, no transparency' },
          { value: 'image/webp', label: 'WebP', title: 'Smallest at the same quality' },
        ],
      },
      {
        name: 'dpi', type: 'select', label: 'Resolution', value: '150',
        options: [
          { value: '72', label: '72 dpi — screen' },
          { value: '96', label: '96 dpi' },
          { value: '150', label: '150 dpi — good print' },
          { value: '200', label: '200 dpi' },
          { value: '300', label: '300 dpi — full print' },
          { value: '600', label: '600 dpi — archival, slow' },
        ],
        hint: 'A 300 dpi A4 page is about 2480 × 3508 pixels.',
      },
      {
        name: 'quality', type: 'range', label: 'Quality', value: 88, min: 40, max: 100, step: 1, suffix: '%',
        when: (v) => v.format !== 'image/png',
      },
      {
        name: 'bg', type: 'segmented', label: 'Behind the page', value: 'white',
        options: [{ value: 'white', label: 'White' }, { value: 'transparent', label: 'Transparent' }],
        when: (v) => v.format !== 'image/jpeg',
        hint: 'Transparent only matters for pages that do not paint their own background.',
      },
      { name: 'prefix', type: 'text', label: 'Name the images', value: '', placeholder: 'taken from the source file' },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      const res = checkRange(a.values.pages, total || 1);
      return res.ok ? null : res.error;
    },

    async run(a) {
      const file = a.files[0];
      const viewer = await openViewer(file);
      const v = a.values;
      const wanted = parseRange(v.pages, viewer.numPages);
      if (!wanted.length) throw new Error('That range selects no pages.');

      const scale = Number(v.dpi) / 72;
      const ext = v.format === 'image/jpeg' ? 'jpg' : v.format === 'image/webp' ? 'webp' : 'png';
      const base = safeName(v.prefix || stem(file.name));
      const quality = v.format === 'image/png' ? undefined : v.quality / 100;
      const background = v.format === 'image/jpeg' || v.bg === 'white' ? '#ffffff' : null;

      const outputs = [];
      let biggest = 0;

      for (let i = 0; i < wanted.length; i++) {
        const n = wanted[i];
        await a.progress(i / wanted.length, `Rendering page ${n + 1} (${i + 1} of ${wanted.length})…`);
        const page = await viewer.getPage(n + 1);
        const canvas = await renderPage(page, scale, { background: background || 'rgba(0,0,0,0)' });
        const dims = `${canvas.width} × ${canvas.height} px`;
        biggest = Math.max(biggest, canvas.width, canvas.height);
        const blob = await canvasToBlob(canvas, v.format, quality);
        page.cleanup();
        canvas.width = canvas.height = 0; // release the backing store early
        outputs.push({ name: `${base}-${pad(n + 1, viewer.numPages)}.${ext}`, blob, note: dims });
      }

      viewer.destroy();
      const totalBytes = outputs.reduce((sum, o) => sum + o.blob.size, 0);
      await a.done(outputs, { zipName: `${base}-${ext}.zip` });
      a.status(`${plural(outputs.length, 'image')} · ${fmtBytes(totalBytes)} · longest side ${biggest}px`);
    },
  });
}
