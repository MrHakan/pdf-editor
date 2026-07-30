import { workbench } from '../ui/workbench.js';
import { livePreview } from '../ui/preview.js';
import { openDoc, saveDoc } from '../core/pdf.js';
import { embedFont, fontOptions } from '../core/fonts.js';
import { visualSize, toUser, pageAngle, hexColor, anchorPoint } from '../core/geometry.js';
import { parseRange, checkRange } from '../core/range.js';
import { pdflib } from '../core/lib.js';
import { stem, plural } from '../ui/kit.js';

const PRESETS = [
  { value: '{n}', label: '1' },
  { value: '— {n} —', label: '— 1 —' },
  { value: 'Page {n}', label: 'Page 1' },
  { value: '{n} / {total}', label: '1 / 40' },
  { value: 'Page {n} of {total}', label: 'Page 1 of 40' },
  { value: '{roman}', label: 'i, ii, iii' },
  { value: '{ROMAN}', label: 'I, II, III' },
  { value: '{alpha}', label: 'a, b, c' },
];

export default function mount(host, tool) {
  let total = 0;
  let preview = null;

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Number the pages',
    actionIcon: 'pageNumbers',
    dropTitle: 'Choose a PDF to number, or drop it here',

    async onFiles(a) {
      total = 0;
      if (!a.files[0]) return;
      const doc = await openDoc(a.files[0]);
      total = doc.getPageCount();
      a.renderStage();
      await preview?.setFile(a.files[0]);
      a.refreshFields();
    },

    stage(a, stageEl) {
      if (!preview) {
        preview = livePreview({
          label: 'Proof',
          build: async (one, { pageIndex }) => numberPages(one, a.values, [0], { total, offsetIndex: pageIndex }),
        });
      }
      stageEl.append(preview.el);
      if (a.files[0] && preview.pageCount === 0) preview.setFile(a.files[0]);
    },

    onFieldChange(a, name) {
      if (name === 'preset' && a.values.preset) { a.setField('format', a.values.preset); }
      preview?.refresh();
    },

    fields: [
      { name: 'preset', type: 'select', label: 'Style', value: '{n}', options: PRESETS },
      {
        name: 'format', type: 'text', label: 'Exact wording', value: '{n}',
        hint: 'Tokens: {n} {total} {roman} {ROMAN} {alpha} {title} {date} {file}',
      },
      { name: 'anchor', type: 'anchor', label: 'Position', value: 'bottom' },
      { name: 'font', type: 'select', label: 'Typeface', value: 'helvetica', options: fontOptions },
      { name: 'size', type: 'range', label: 'Size', value: 10, min: 6, max: 28, step: 0.5, suffix: ' pt' },
      { name: 'color', type: 'color', label: 'Colour', value: '#404650' },
      { name: 'marginX', type: 'range', label: 'Side margin', value: 36, min: 6, max: 120, step: 2, suffix: ' pt' },
      { name: 'marginY', type: 'range', label: 'Top and bottom margin', value: 28, min: 6, max: 120, step: 2, suffix: ' pt' },
      {
        name: 'mirror', type: 'checkbox', label: 'Mirror on facing pages', value: false,
        hint: 'Moves the number to the outer edge, as a bound book does.',
        when: (v) => v.anchor.includes('left') || v.anchor.includes('right'),
      },
      { name: 'heading', type: 'heading', label: 'Numbering' },
      { name: 'startAt', type: 'number', label: 'First number', value: 1, step: 1 },
      {
        name: 'pages', type: 'pages', label: 'Number these pages', value: 'all',
        check: (spec) => {
          if (!total) return { ok: true, text: '' };
          const res = checkRange(spec, total);
          return res.ok ? { ok: true, text: `${res.count} of ${total}` } : { ok: false, text: 'unreadable' };
        },
      },
      {
        name: 'countAll', type: 'checkbox', label: 'Count pages that are skipped', value: true,
        hint: 'Off means a cover page does not take a number from the count.',
      },
      { name: 'box', type: 'checkbox', label: 'Put the number on a light plate', value: false, hint: 'Helps where the page is busy.' },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      if (!String(a.values.format).trim()) return 'Write the wording, or pick a style.';
      const res = checkRange(a.values.pages, total || 1);
      return res.ok ? null : res.error;
    },

    async run(a) {
      const file = a.files[0];
      const doc = await openDoc(file);
      const count = doc.getPageCount();
      const indices = parseRange(a.values.pages, count);
      if (!indices.length) throw new Error('That range selects no pages.');

      await a.progress(0.3, `Numbering ${plural(indices.length, 'page')}…`);
      await numberPages(doc, a.values, indices, { total: count, fileName: stem(file.name) });

      await a.progress(0.9, 'Saving…');
      await a.done([{ name: `${stem(file.name)}-numbered.pdf`, data: await saveDoc(doc), note: `${plural(indices.length, 'page')} numbered` }]);
    },
  });
}

async function numberPages(doc, v, indices, { total = 0, fileName = '', offsetIndex = 0 } = {}) {
  const { degrees } = await pdflib();
  const pages = doc.getPages();
  const colour = await hexColor(v.color);
  const size = Number(v.size);
  const start = Number(v.startAt) || 1;
  const grandTotal = total || pages.length;

  const label = (i, seq) => render(v.format, {
    n: seq,
    total: v.countAll ? grandTotal : indices.length,
    title: safeMeta(() => doc.getTitle()) || fileName,
    file: fileName,
    date: new Date().toLocaleDateString(),
  });

  const sample = indices.map((_, k) => label(0, start + k)).join('');
  const { font, substituted } = await embedFont(doc, v.font, { text: sample });

  for (let k = 0; k < indices.length; k++) {
    const pageIndex = indices[k];
    const page = pages[pageIndex];
    if (!page) continue;

    const absolute = offsetIndex || pageIndex;
    const seq = v.countAll ? start + absolute : start + k;
    const text = label(pageIndex, seq);
    if (!text) continue;

    const { width: vw, height: vh } = visualSize(page);
    const textW = font.widthOfTextAtSize(text, size);
    const textH = font.heightAtSize(size) * 0.7;

    let anchor = v.anchor;
    if (v.mirror && (anchor.includes('left') || anchor.includes('right'))) {
      const odd = (absolute + 1) % 2 === 1;
      anchor = odd ? anchor.replace('left', 'right') : anchor.replace('right', 'left');
    }

    const box = { x: Number(v.marginX), y: Number(v.marginY), width: vw - Number(v.marginX) * 2, height: vh - Number(v.marginY) * 2 };
    const pos = anchorPoint(anchor, box, textW, textH);
    const p = toUser(page, pos.x, pos.y);
    const rotate = degrees(pageAngle(page));

    if (v.box) {
      const padX = size * 0.55, padY = size * 0.35;
      const plate = toUser(page, pos.x - padX, pos.y - padY);
      page.drawRectangle({
        x: plate.x, y: plate.y, width: textW + padX * 2, height: textH + padY * 2,
        rotate, color: colour, opacity: 0.08,
      });
    }

    page.drawText(text, { x: p.x, y: p.y, size, font, color: colour, rotate });
  }

  return { substituted };
}

function render(format, vars) {
  return String(format)
    .replace(/\{n\}/g, vars.n)
    .replace(/\{total\}/g, vars.total)
    .replace(/\{roman\}/g, roman(vars.n).toLowerCase())
    .replace(/\{ROMAN\}/g, roman(vars.n))
    .replace(/\{alpha\}/g, alpha(vars.n))
    .replace(/\{title\}/g, vars.title || '')
    .replace(/\{file\}/g, vars.file || '')
    .replace(/\{date\}/g, vars.date || '')
    .trim();
}

function roman(n) {
  if (n < 1 || n > 3999) return String(n);
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [value, sym] of table) while (n >= value) { out += sym; n -= value; }
  return out;
}

function alpha(n) {
  let out = '';
  let x = Math.max(1, n);
  while (x > 0) { const r = (x - 1) % 26; out = String.fromCharCode(97 + r) + out; x = Math.floor((x - 1) / 26); }
  return out;
}

const safeMeta = (fn) => { try { return fn(); } catch { return ''; } };
