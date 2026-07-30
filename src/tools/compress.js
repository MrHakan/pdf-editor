import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { openDoc, openViewer, saveDoc, renderPage, copyMetadata } from '../core/pdf.js';
import { canvasToBlob } from '../core/files.js';
import { stem, plural, bytes as fmtBytes, h, icon } from '../ui/kit.js';

const LEVELS = {
  light: { label: 'Light', dpi: 200, quality: 0.82, blurb: 'Text stays crisp. Good for archiving.' },
  medium: { label: 'Balanced', dpi: 144, quality: 0.7, blurb: 'The usual choice for sharing.' },
  strong: { label: 'Strong', dpi: 110, quality: 0.55, blurb: 'For email limits. Small print softens.' },
};

/**
 * Compression by resampling.
 *
 * Real PDF optimisers rewrite each image object in place. That needs a decoder
 * for every filter a PDF may use, which no browser has, so this renders pages
 * and re-encodes them instead. Honest about the trade: it always shows the
 * saving and refuses to hand back a file that came out larger.
 */
export default function mount(host, tool) {
  let originalSize = 0;

  const wb = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Compress',
    actionIcon: 'compress',
    dropTitle: 'Choose the PDF to shrink, or drop it here',

    async onFiles(a) {
      originalSize = a.files[0]?.size || 0;
      a.status(originalSize ? `Starting from ${fmtBytes(originalSize)}` : '');
    },

    fields: [
      {
        name: 'level', type: 'segmented', label: 'How hard to squeeze', value: 'medium',
        options: Object.entries(LEVELS).map(([k, l]) => ({ value: k, label: l.label, title: l.blurb })),
        update: (v, row) => { row.el.querySelector('.field__hint')?.replaceChildren(LEVELS[v.level].blurb); },
        hint: LEVELS.medium.blurb,
      },
      {
        name: 'mode', type: 'segmented', label: 'Method', value: 'raster',
        options: [
          { value: 'clean', label: 'Rewrite only', title: 'Lossless: drops unused objects and rewrites the file' },
          { value: 'raster', label: 'Resample', title: 'Renders each page at a lower resolution' },
        ],
        hint: 'Rewrite only is lossless but saves little on files that are mostly images. Resample is where the real saving is.',
      },
      { name: 'grayscale', type: 'checkbox', label: 'Convert to grayscale', value: false, when: (v) => v.mode === 'raster', hint: 'Often removes another third from a colour scan.' },
      { name: 'keepText', type: 'note', kind: 'warn', when: (v) => v.mode === 'raster', text: 'Resampling turns pages into images, so text stops being selectable or searchable. Use Rewrite only if you need to keep the text layer.' },
      { name: 'strip', type: 'checkbox', label: 'Drop metadata', value: false, hint: 'Removes the title, author and dates.' },
    ],

    async run(a) {
      const { PDFDocument } = await pdflib();
      const file = a.files[0];
      const v = a.values;
      const level = LEVELS[v.level];
      const src = await openDoc(file);

      let bytes;
      if (v.mode === 'clean') {
        await a.progress(0.4, 'Rewriting the file…');
        const out = await PDFDocument.create();
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach((p) => out.addPage(p));
        if (!v.strip) copyMetadata(src, out);
        bytes = await saveDoc(out, { useObjectStreams: true });
      } else {
        const viewer = await openViewer(file);
        const out = await PDFDocument.create();
        const scale = level.dpi / 72;

        for (let i = 0; i < viewer.numPages; i++) {
          await a.progress(i / viewer.numPages, `Resampling page ${i + 1} of ${viewer.numPages}…`);
          const page = await viewer.getPage(i + 1);
          const canvas = await renderPage(page, scale);
          if (v.grayscale) desaturate(canvas);
          const blob = await canvasToBlob(canvas, 'image/jpeg', level.quality);
          page.cleanup();

          const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const source = src.getPage(i);
          const size = source.getSize();
          const rotated = source.getRotation().angle % 180 !== 0;
          const w = rotated ? size.height : size.width;
          const hgt = rotated ? size.width : size.height;
          const fresh = out.addPage([w, hgt]);
          fresh.drawImage(image, { x: 0, y: 0, width: w, height: hgt });
          canvas.width = canvas.height = 0;
        }
        viewer.destroy();
        if (!v.strip) copyMetadata(src, out);
        bytes = await saveDoc(out);
      }

      const saved = originalSize - bytes.byteLength;
      const percent = originalSize ? Math.round((saved / originalSize) * 100) : 0;

      if (saved <= 0) {
        a.toast('This file is already smaller than anything Quire would produce, so the original is the better copy.', 'error');
        a.status(`No saving — ${fmtBytes(originalSize)} in, ${fmtBytes(bytes.byteLength)} out. Nothing was written.`);
        return;
      }

      await a.done([{
        name: `${stem(file.name)}-compressed.pdf`,
        data: bytes,
        note: `${fmtBytes(originalSize)} → ${fmtBytes(bytes.byteLength)}`,
      }]);
      a.status(`${percent}% smaller · saved ${fmtBytes(saved)} across ${plural(src.getPageCount(), 'page')}`);
    },
  });

  wb.panelBody.prepend(h('div.notice.notice--info', [icon('info', 15), h('div', 'The saving is measured before anything is written, and a result that came out bigger is never handed back.')]));
  return wb;
}

function desaturate(canvas) {
  const ctx = canvas.getContext('2d');
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(image, 0, 0);
}
