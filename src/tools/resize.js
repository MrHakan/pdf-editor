import { workbench } from '../ui/workbench.js';
import { canvasStage } from '../ui/canvasstage.js';
import { pdflib } from '../core/lib.js';
import { openDoc, saveDoc, copyMetadata, PAGE_SIZES } from '../core/pdf.js';
import { parseRange, checkRange } from '../core/range.js';
import { mm } from '../core/geometry.js';
import { h, icon, stem, plural } from '../ui/kit.js';

/**
 * Change the paper: scale pages to a standard size, crop away scanner borders,
 * or add space in the margins for notes and binding.
 */
export default function mount(host, tool) {
  let stage = null;
  let total = 0;
  let cropBox = null; // in visual points of the previewed page

  const wb = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Rewrite the pages',
    actionIcon: 'resize',
    dropTitle: 'Choose a PDF, or drop it here',

    async onFiles(a) {
      total = 0;
      cropBox = null;
      if (!a.files[0]) { stage?.destroy(); stage = null; return; }
      const doc = await openDoc(a.files[0]);
      total = doc.getPageCount();
      a.renderStage();
      await stage.setFile(a.files[0]);
      a.refreshFields();
    },

    stage(a, stageEl) {
      if (!stage) {
        stage = canvasStage({
          minSize: 10,
          newItem: (rect) => {
            if (a.values.mode !== 'crop') return null;
            if (rect.w < 10 || rect.h < 10) return null;
            stage.clearAll();
            cropBox = rect;
            a.refreshFields();
            return { kind: 'crop', ...rect };
          },
          draw: () => h('div', {
            style: {
              width: '100%', height: '100%',
              outline: '9999px solid color-mix(in srgb, var(--bed) 72%, transparent)',
              border: '1px dashed var(--accent)',
            },
          }),
          onChange: () => { const box = stage.items[0]; if (box) cropBox = box; },
        });
      }
      stageEl.append(
        h('div.stage__toolbar', [
          h('span.stage__hint', a.values.mode === 'crop' ? 'Drag the area to keep' : 'Crop area is only used in Crop mode'),
          h('span.spacer'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { stage.clearAll(); cropBox = null; a.refreshFields(); } }, [icon('reset', 13), 'Clear crop']),
          stage.pager,
        ]),
        stage.el,
      );
      if (a.files[0] && !stage.pageCount) stage.setFile(a.files[0]);
    },

    onFieldChange(a, name) { if (name === 'mode') a.renderStage(); },

    fields: [
      {
        name: 'mode', type: 'segmented', label: 'What to change', value: 'size',
        options: [
          { value: 'size', label: 'Page size' },
          { value: 'crop', label: 'Crop' },
          { value: 'margin', label: 'Margins' },
        ],
      },

      { name: 'target', type: 'select', label: 'New size', value: 'a4', options: Object.entries(PAGE_SIZES).map(([k, s]) => ({ value: k, label: s.label })), when: (v) => v.mode === 'size' },
      { name: 'orientation', type: 'segmented', label: 'Orientation', value: 'keep', options: [{ value: 'keep', label: 'Keep' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }], when: (v) => v.mode === 'size' },
      { name: 'fit', type: 'segmented', label: 'Content', value: 'fit', options: [{ value: 'fit', label: 'Scale to fit' }, { value: 'center', label: 'Keep size, centre' }], when: (v) => v.mode === 'size' },

      {
        name: 'cropNote', type: 'note', kind: 'info', when: (v) => v.mode === 'crop',
        text: 'Drag a box on the page to mark what to keep. Cropping sets the visible area — the content outside it is hidden by the crop box, not deleted.',
        update: (v, row) => { row.el.querySelector('div:last-child').textContent = cropBox ? `Keeping ${Math.round(cropBox.w)} × ${Math.round(cropBox.h)} pt of the page. Everything outside the box is trimmed away on export.` : 'Drag a box on the page to mark what to keep. The area outside it is trimmed.'; },
      },
      { name: 'cropAll', type: 'checkbox', label: 'Use the same crop on every page', value: true, when: (v) => v.mode === 'crop' },
      { name: 'hardCrop', type: 'checkbox', label: 'Discard the trimmed content', value: false, when: (v) => v.mode === 'crop', hint: 'Rebuilds each page so the hidden content is really gone. Flattens links and form fields.' },

      { name: 'top', type: 'number', label: 'Extra space at the top (mm)', value: 0, step: 1, when: (v) => v.mode === 'margin' },
      { name: 'bottom', type: 'number', label: 'Extra at the bottom (mm)', value: 0, step: 1, when: (v) => v.mode === 'margin' },
      { name: 'left', type: 'number', label: 'Extra on the left (mm)', value: 0, step: 1, when: (v) => v.mode === 'margin' },
      { name: 'right', type: 'number', label: 'Extra on the right (mm)', value: 0, step: 1, when: (v) => v.mode === 'margin' },
      { name: 'marginNote', type: 'note', kind: 'info', when: (v) => v.mode === 'margin', text: 'Negative numbers pull the edges in, which crops. Positive numbers add blank paper.' },

      {
        name: 'pages', type: 'pages', label: 'Pages', value: 'all',
        check: (spec) => {
          if (!total) return { ok: true, text: '' };
          const res = checkRange(spec, total);
          return res.ok ? { ok: true, text: `${res.count} of ${total}` } : { ok: false, text: 'unreadable' };
        },
      },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      if (a.values.mode === 'crop' && !cropBox) return 'Drag a box on the page to say what to keep.';
      const res = checkRange(a.values.pages, total || 1);
      return res.ok ? null : res.error;
    },

    async run(a) {
      const { PDFDocument } = await pdflib();
      const file = a.files[0];
      const v = a.values;
      const src = await openDoc(file);
      let indices = new Set(parseRange(v.pages, src.getPageCount()));
      // A crop drawn on one page only travels to the others when asked.
      if (v.mode === 'crop' && !v.cropAll) indices = new Set([cropBox.page]);

      if (v.mode === 'crop' && !v.hardCrop) {
        await a.progress(0.4, 'Setting the crop box…');
        src.getPages().forEach((page, i) => {
          if (!indices.has(i)) return;
          applyCropBox(page, cropBox);
        });
        await a.progress(0.9, 'Saving…');
        await a.done([{ name: `${stem(file.name)}-cropped.pdf`, data: await saveDoc(src), note: `${plural(indices.size, 'page')} cropped` }]);
        return;
      }

      const out = await PDFDocument.create();
      const pages = src.getPages();
      const embedded = await out.embedPages(pages);

      for (let i = 0; i < pages.length; i++) {
        if (i % 5 === 0) await a.progress(i / pages.length, `Page ${i + 1} of ${pages.length}…`);
        const page = pages[i];
        const size = page.getSize();
        const rotated = page.getRotation().angle % 180 !== 0;
        const visW = rotated ? size.height : size.width;
        const visH = rotated ? size.width : size.height;

        if (!indices.has(i)) {
          const [kept] = await out.copyPages(src, [i]);
          out.addPage(kept);
          continue;
        }

        if (v.mode === 'crop') {
          const box = cropBox;
          const fresh = out.addPage([box.w, box.h]);
          fresh.drawPage(embedded[i], { x: -box.x, y: -box.y, width: visW, height: visH });
          continue;
        }

        if (v.mode === 'margin') {
          const left = mm(Number(v.left) || 0);
          const right = mm(Number(v.right) || 0);
          const top = mm(Number(v.top) || 0);
          const bottom = mm(Number(v.bottom) || 0);
          const w = Math.max(24, visW + left + right);
          const hgt = Math.max(24, visH + top + bottom);
          const fresh = out.addPage([w, hgt]);
          fresh.drawPage(embedded[i], { x: left, y: bottom, width: visW, height: visH });
          continue;
        }

        const base = PAGE_SIZES[v.target];
        let tw = base.w, th = base.h;
        const wantLandscape = v.orientation === 'landscape' || (v.orientation === 'keep' && visW > visH);
        if (wantLandscape) [tw, th] = [th, tw];
        const fresh = out.addPage([tw, th]);
        if (v.fit === 'fit') {
          const scale = Math.min(tw / visW, th / visH);
          fresh.drawPage(embedded[i], { x: (tw - visW * scale) / 2, y: (th - visH * scale) / 2, width: visW * scale, height: visH * scale });
        } else {
          fresh.drawPage(embedded[i], { x: (tw - visW) / 2, y: (th - visH) / 2, width: visW, height: visH });
        }
      }

      copyMetadata(src, out);
      await a.progress(0.94, 'Saving…');
      const suffix = v.mode === 'crop' ? 'cropped' : v.mode === 'margin' ? 'margins' : 'resized';
      await a.done([{ name: `${stem(file.name)}-${suffix}.pdf`, data: await saveDoc(out), note: `${plural(pages.length, 'page')} written` }]);
    },
  });

  return wb;
}

/** Set /CropBox on a page, in unrotated user space. */
function applyCropBox(page, box) {
  const size = page.getSize();
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  let x = box.x, y = box.y, w = box.w, hgt = box.h;
  if (angle === 90) { x = size.width - (box.y + box.h); y = box.x; w = box.h; hgt = box.w; }
  else if (angle === 180) { x = size.width - (box.x + box.w); y = size.height - (box.y + box.h); }
  else if (angle === 270) { x = box.y; y = size.height - (box.x + box.w); w = box.h; hgt = box.w; }
  const media = page.getMediaBox();
  page.setCropBox(media.x + x, media.y + y, w, hgt);
}
