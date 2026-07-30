import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { openDoc, saveDoc, copyMetadata, PAGE_SIZES } from '../core/pdf.js';
import { stem, plural } from '../ui/kit.js';
import { mm } from '../core/geometry.js';

/**
 * Imposition: lay several document pages onto each printed sheet, or reorder a
 * document into booklet signatures so a folded, stapled stack reads in order.
 */
export default function mount(host, tool) {
  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Impose the sheets',
    actionIcon: 'impose',
    dropTitle: 'Choose a PDF to impose, or drop it here',

    fields: [
      {
        name: 'layout', type: 'segmented', label: 'Sheet layout', value: '2',
        options: [
          { value: '2', label: '2-up' },
          { value: '4', label: '4-up' },
          { value: '8', label: '8-up' },
          { value: 'booklet', label: 'Booklet' },
        ],
      },
      {
        name: 'bookletNote', type: 'note', kind: 'info',
        when: (v) => v.layout === 'booklet',
        text: 'Print double-sided, flip on the short edge, fold the stack in half and staple the spine. Blank pages are added so the count divides by four.',
      },
      {
        name: 'size', type: 'select', label: 'Sheet size', value: 'auto',
        options: [{ value: 'auto', label: 'Follow the source page' }, ...Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label }))],
      },
      {
        name: 'orientation', type: 'segmented', label: 'Sheet orientation', value: 'auto',
        options: [{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
        hint: 'Auto turns the sheet so the pages fill it.',
      },
      { name: 'margin', type: 'range', label: 'Sheet margin', value: 8, min: 0, max: 30, step: 1, suffix: ' mm' },
      { name: 'gutter', type: 'range', label: 'Gap between pages', value: 4, min: 0, max: 30, step: 1, suffix: ' mm' },
      { name: 'frame', type: 'checkbox', label: 'Draw a hairline around each page', value: false, hint: 'Useful as a cutting guide.' },
      { name: 'crop', type: 'checkbox', label: 'Add trim marks at the sheet corners', value: false },
    ],

    async run(a) {
      const { PDFDocument, rgb } = await pdflib();
      const file = a.files[0];
      const src = await openDoc(file);
      const v = a.values;
      const count = src.getPageCount();

      const out = await PDFDocument.create();
      const margin = mm(v.margin);
      const gutter = mm(v.gutter);

      const first = src.getPage(0);
      const srcSize = first.getSize();
      const srcRot = (first.getRotation().angle % 180 !== 0);
      const pageW = srcRot ? srcSize.height : srcSize.width;
      const pageH = srcRot ? srcSize.width : srcSize.height;

      const booklet = v.layout === 'booklet';
      const perSheet = booklet ? 2 : Number(v.layout);
      const [cols, rows] = booklet ? [2, 1] : perSheet === 2 ? [2, 1] : perSheet === 4 ? [2, 2] : [4, 2];

      // Order the pages, padding as the layout requires.
      const order = booklet ? bookletOrder(count) : [...Array(count).keys()];
      const padded = booklet ? order : order.concat(Array((perSheet - (count % perSheet)) % perSheet).fill(null));

      // Sheet dimensions.
      let sheetW, sheetH;
      if (v.size === 'auto') {
        sheetW = pageW * cols + gutter * (cols - 1) + margin * 2;
        sheetH = pageH * rows + gutter * (rows - 1) + margin * 2;
      } else {
        const s = PAGE_SIZES[v.size];
        const wantLandscape = v.orientation === 'landscape' || (v.orientation === 'auto' && cols >= rows && pageH >= pageW);
        sheetW = wantLandscape ? s.h : s.w;
        sheetH = wantLandscape ? s.w : s.h;
      }
      if (v.size === 'auto' && v.orientation !== 'auto') {
        const wantLandscape = v.orientation === 'landscape';
        if (wantLandscape !== sheetW > sheetH) [sheetW, sheetH] = [sheetH, sheetW];
      }

      const cellW = (sheetW - margin * 2 - gutter * (cols - 1)) / cols;
      const cellH = (sheetH - margin * 2 - gutter * (rows - 1)) / rows;

      const uniquePages = Array.from(new Set(padded.filter((i) => i !== null)));
      await a.progress(0.15, 'Embedding pages…');
      const embeds = await out.embedPages(uniquePages.map((i) => src.getPage(i)));
      const embedByIndex = new Map(uniquePages.map((i, k) => [i, embeds[k]]));

      const sheetCount = Math.ceil(padded.length / perSheet);
      for (let s = 0; s < sheetCount; s++) {
        if (s % 4 === 0) await a.progress(0.15 + 0.75 * (s / sheetCount), `Sheet ${s + 1} of ${sheetCount}…`);
        const sheet = out.addPage([sheetW, sheetH]);

        for (let slot = 0; slot < perSheet; slot++) {
          const idx = padded[s * perSheet + slot];
          if (idx === null || idx === undefined) continue;
          const embedded = embedByIndex.get(idx);
          if (!embedded) continue;

          const col = slot % cols;
          const row = Math.floor(slot / cols);
          const cellX = margin + col * (cellW + gutter);
          const cellY = sheetH - margin - (row + 1) * cellH - row * gutter;

          const scale = Math.min(cellW / embedded.width, cellH / embedded.height);
          const w = embedded.width * scale;
          const h = embedded.height * scale;
          const x = cellX + (cellW - w) / 2;
          const y = cellY + (cellH - h) / 2;

          sheet.drawPage(embedded, { x, y, xScale: scale, yScale: scale });
          if (v.frame) sheet.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.4 });
        }

        if (v.crop) drawTrimMarks(sheet, sheetW, sheetH, margin, rgb);
      }

      copyMetadata(src, out, { titleSuffix: booklet ? ' (booklet)' : ` (${perSheet}-up)` });
      await a.progress(0.95, 'Saving…');
      const suffix = booklet ? 'booklet' : `${perSheet}up`;
      await a.done([{
        name: `${stem(file.name)}-${suffix}.pdf`,
        data: await saveDoc(out),
        note: `${plural(sheetCount, 'sheet')} · ${plural(count, 'source page')}`,
      }]);
    },
  });
}

/**
 * Booklet order. Pages are padded to a multiple of four, then paired so that
 * folding the printed stack down the middle produces a document in sequence.
 */
function bookletOrder(count) {
  const total = Math.ceil(count / 4) * 4;
  const page = (n) => (n < count ? n : null);
  const out = [];
  let left = 0;
  let right = total - 1;
  while (left < right) {
    out.push(page(right), page(left));       // front of the sheet
    out.push(page(left + 1), page(right - 1)); // back of the sheet
    left += 2;
    right -= 2;
  }
  return out;
}

function drawTrimMarks(sheet, w, h, margin, rgb) {
  const len = Math.min(margin * 0.7, 14);
  if (len < 3) return;
  const gap = Math.min(margin * 0.25, 4);
  const grey = rgb(0.4, 0.4, 0.4);
  const line = (x1, y1, x2, y2) => sheet.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.35, color: grey });
  const corners = [[margin, margin, -1, -1], [w - margin, margin, 1, -1], [margin, h - margin, -1, 1], [w - margin, h - margin, 1, 1]];
  for (const [x, y, sx, sy] of corners) {
    line(x + sx * gap, y, x + sx * (gap + len), y);
    line(x, y + sy * gap, x, y + sy * (gap + len));
  }
}
