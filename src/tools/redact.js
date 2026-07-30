import { workbench } from '../ui/workbench.js';
import { canvasStage } from '../ui/canvasstage.js';
import { pdflib } from '../core/lib.js';
import { openDoc, openViewer, saveDoc, renderPage, copyMetadata } from '../core/pdf.js';
import { hexColor } from '../core/geometry.js';
import { canvasToBlob } from '../core/files.js';
import { h, icon, stem, plural } from '../ui/kit.js';

/**
 * Redaction that actually removes.
 *
 * Painting a black rectangle over text leaves the text in the file, where any
 * reader can select it. So every page carrying a redaction is rendered to a
 * bitmap with the boxes burned in and the original page is replaced by that
 * image. The words underneath stop existing.
 */
export default function mount(host, tool) {
  let stage = null;

  const wb = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Redact and rebuild',
    actionIcon: 'redact',
    dropTitle: 'Choose the PDF to redact, or drop it here',
    dropHint: 'Drag across anything that must not be readable',

    async onFiles(a) {
      if (!a.files[0]) { stage?.destroy(); stage = null; return; }
      a.renderStage();
      await stage.setFile(a.files[0]);
    },

    stage(a, stageEl) {
      if (!stage) {
        stage = canvasStage({
          minSize: 4,
          newItem: (rect) => (rect.w < 4 || rect.h < 4 ? null : { kind: 'redact', ...rect }),
          draw: () => h('div', { style: { width: '100%', height: '100%', background: 'var(--danger)', opacity: '.85' } }),
          onChange: (s) => a.enableRun(s.items.length > 0),
        });
      }
      stageEl.append(
        h('div.stage__toolbar', [
          h('span.stage__hint', 'Drag across text, faces or numbers'),
          h('span.spacer'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => stage.clearPage() }, 'Clear page'),
          h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => stage.clearAll() }, 'Clear all'),
          stage.pager,
        ]),
        stage.el,
      );
      if (a.files[0] && !stage.pageCount) stage.setFile(a.files[0]);
    },

    fields: [
      {
        name: 'warn', type: 'note', kind: 'danger',
        text: 'Redacted pages come back as pictures. Text, links and selectable content on those pages are destroyed, not hidden — which is the point, but it also means they cannot be searched afterwards. Open the result and check it before sending it on.',
      },
      { name: 'color', type: 'color', label: 'Box colour', value: '#000000' },
      {
        name: 'dpi', type: 'select', label: 'Rebuild resolution', value: '200',
        options: [
          { value: '150', label: '150 dpi — smaller file' },
          { value: '200', label: '200 dpi — balanced' },
          { value: '300', label: '300 dpi — print quality' },
          { value: '400', label: '400 dpi — large file' },
        ],
        hint: 'Only pages you redacted are rebuilt. Everything else is left alone.',
      },
      {
        name: 'format', type: 'segmented', label: 'Rebuilt pages as', value: 'image/jpeg',
        options: [{ value: 'image/jpeg', label: 'JPEG' }, { value: 'image/png', label: 'PNG' }],
        hint: 'JPEG keeps scans small. PNG is sharper for pages that are mostly text.',
      },
      { name: 'quality', type: 'range', label: 'JPEG quality', value: 85, min: 50, max: 100, step: 1, suffix: '%', when: (v) => v.format === 'image/jpeg' },
      { name: 'strip', type: 'checkbox', label: 'Strip metadata from the result', value: true, hint: 'Clears the title, author and dates the file was carrying.' },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      if (!stage?.items.length) return 'Drag over the content you want removed.';
      return null;
    },

    async run(a) {
      const { PDFDocument } = await pdflib();
      const file = a.files[0];
      const v = a.values;
      const src = await openDoc(file);
      const viewer = await openViewer(file);
      const colour = await hexColor(v.color);

      const byPage = new Map();
      for (const item of stage.items) {
        if (!byPage.has(item.page)) byPage.set(item.page, []);
        byPage.get(item.page).push(item);
      }

      const out = await PDFDocument.create();
      const scale = Number(v.dpi) / 72;
      const total = src.getPageCount();

      // Copy the untouched pages first so the loop below can add every page in
      // document order and the sequence never needs repairing.
      const untouched = [];
      for (let i = 0; i < total; i++) if (!byPage.has(i)) untouched.push(i);
      const copied = untouched.length ? await out.copyPages(src, untouched) : [];
      const copyByIndex = new Map(untouched.map((idx, k) => [idx, copied[k]]));

      for (let i = 0; i < total; i++) {
        await a.progress(i / total, `Page ${i + 1} of ${total}…`);
        const boxes = byPage.get(i);
        if (!boxes) { out.addPage(copyByIndex.get(i)); continue; }

        const page = await viewer.getPage(i + 1);
        const canvas = await renderPage(page, scale);
        const ctx = canvas.getContext('2d');
        const vp = page.getViewport({ scale });

        // Boxes are held in visual points; the canvas is the visual page scaled.
        ctx.fillStyle = v.color;
        for (const box of boxes) {
          ctx.fillRect(box.x * scale, vp.height - (box.y + box.h) * scale, box.w * scale, box.h * scale);
        }
        page.cleanup();

        const blob = await canvasToBlob(canvas, v.format, v.format === 'image/jpeg' ? v.quality / 100 : undefined);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const image = v.format === 'image/jpeg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);

        const source = src.getPage(i);
        const rot = source.getRotation().angle % 180 !== 0;
        const size = source.getSize();
        const wide = rot ? size.height : size.width;
        const tall = rot ? size.width : size.height;
        const fresh = out.addPage([wide, tall]);
        fresh.drawImage(image, { x: 0, y: 0, width: wide, height: tall });
        canvas.width = canvas.height = 0;
      }

      viewer.destroy();

      if (!v.strip) copyMetadata(src, out);
      else { out.setProducer('Quire'); out.setModificationDate(new Date()); }

      await a.progress(0.96, 'Saving…');
      await a.done([{
        name: `${stem(file.name)}-redacted.pdf`,
        data: await saveDoc(out),
        note: `${plural(byPage.size, 'page')} rebuilt · ${plural(stage.items.length, 'box')}`,
      }]);
      a.toast('Open the file and confirm nothing readable is left before you send it.', 'ok');
    },
  });

  wb.panelBody.prepend(h('div.notice', { style: { marginBottom: '.2rem' } }, [icon('shield', 15), h('div', 'Nothing is uploaded to do this — the rebuild happens in this tab.')]));
  return wb;
}
