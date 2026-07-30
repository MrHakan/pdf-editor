import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { openDoc, openViewer, saveDoc, renderPage } from '../core/pdf.js';
import { embedFont } from '../core/fonts.js';
import { toUser, pageAngle } from '../core/geometry.js';
import { parseRange, checkRange } from '../core/range.js';
import { stem, plural, h, icon, bytes as fmtBytes } from '../ui/kit.js';

const LANGUAGES = [
  { value: 'eng', label: 'English' },
  { value: 'tur', label: 'Türkçe' },
  { value: 'deu', label: 'Deutsch' },
  { value: 'fra', label: 'Français' },
  { value: 'spa', label: 'Español' },
  { value: 'ita', label: 'Italiano' },
  { value: 'por', label: 'Português' },
  { value: 'nld', label: 'Nederlands' },
];

const base = new URL('../../vendor/tesseract/', import.meta.url);

/**
 * Optical character recognition, in the tab.
 *
 * Tesseract is compiled to WebAssembly and runs in a worker here — the engine,
 * the language models and the page images all stay on this machine. Recognised
 * words are written back as an invisible text layer positioned over the
 * picture, which is what makes a scan searchable without changing how it looks.
 */
export default function mount(host, tool) {
  let total = 0;
  let scanned = [];

  const wb = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Read the pages',
    actionIcon: 'ocr',
    dropTitle: 'Choose a scanned PDF, or drop it here',
    dropHint: 'Pages that are pictures of text — the ones you cannot select words in',

    async onFiles(a) {
      total = 0;
      scanned = [];
      if (!a.files[0]) return;
      const viewer = await openViewer(a.files[0]);
      total = viewer.numPages;

      // Report which pages already carry text, so nobody OCRs a digital file.
      const withText = [];
      for (let i = 0; i < Math.min(total, 40); i++) {
        const page = await viewer.getPage(i + 1);
        const content = await page.getTextContent();
        if (content.items.some((it) => it.str.trim().length > 2)) withText.push(i + 1);
        page.cleanup();
      }
      viewer.destroy();
      a.status(withText.length
        ? `${plural(withText.length, 'page')} already have a text layer${total > 40 ? ' (checked the first 40)' : ''}`
        : 'No text layer found — this is what OCR is for.');
      a.refreshFields();
    },

    fields: [
      { name: 'lang', type: 'select', label: 'Language on the page', value: 'eng', options: LANGUAGES },
      { name: 'alsoEnglish', type: 'checkbox', label: 'Also look for English', value: false, hint: 'Doubles the model that has to load, but helps with mixed documents.', when: (v) => v.lang !== 'eng' },
      {
        name: 'pages', type: 'pages', label: 'Pages', value: 'all',
        check: (spec) => {
          if (!total) return { ok: true, text: '' };
          const res = checkRange(spec, total);
          return res.ok ? { ok: true, text: `${res.count} of ${total}` } : { ok: false, text: 'unreadable' };
        },
      },
      { name: 'skipText', type: 'checkbox', label: 'Skip pages that already have text', value: true },
      {
        name: 'dpi', type: 'select', label: 'Reading resolution', value: '200',
        options: [
          { value: '150', label: '150 dpi — fastest' },
          { value: '200', label: '200 dpi — recommended' },
          { value: '300', label: '300 dpi — small print, slower' },
        ],
        hint: 'Higher is not always better; 200 dpi suits most scans.',
      },
      {
        name: 'output', type: 'segmented', label: 'Give me', value: 'pdf',
        options: [
          { value: 'pdf', label: 'Searchable PDF' },
          { value: 'both', label: 'PDF and text' },
          { value: 'text', label: 'Text only' },
        ],
      },
      {
        name: 'note', type: 'note', kind: 'warn',
        text: 'The first run downloads the engine and the language model from this site — around 5 MB, cached afterwards. Recognition is slow: budget a few seconds per page.',
      },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      const res = checkRange(a.values.pages, total || 1);
      return res.ok ? null : res.error;
    },

    async run(a) {
      const v = a.values;
      const file = a.files[0];
      const lang = v.lang === 'eng' || !v.alsoEnglish ? v.lang : `${v.lang}+eng`;

      await a.progress(0.02, 'Starting the recognition engine…');
      const { createWorker } = await import(new URL('tesseract.esm.min.js', base).href);
      const worker = await createWorker(lang, 1, {
        workerPath: new URL('worker.min.js', base).href,
        corePath: new URL('core/', base).href,
        langPath: new URL('lang', base).href,
        workerBlobURL: false,
        gzip: true,
        logger: (m) => { if (m.status === 'recognizing text') a.status(`Reading — ${Math.round(m.progress * 100)}%`); },
      });

      try {
        const viewer = await openViewer(file);
        const doc = await openDoc(file);
        const indices = parseRange(v.pages, viewer.numPages);
        const scale = Number(v.dpi) / 72;
        const words = [];
        const textParts = [];
        scanned = [];

        for (let k = 0; k < indices.length; k++) {
          const i = indices[k];
          await a.progress(0.05 + (k / indices.length) * 0.8, `Page ${i + 1} (${k + 1} of ${indices.length})…`);
          const page = await viewer.getPage(i + 1);

          if (v.skipText) {
            const content = await page.getTextContent();
            if (content.items.some((it) => it.str.trim().length > 2)) { page.cleanup(); continue; }
          }

          const canvas = await renderPage(page, scale);
          page.cleanup();
          const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
          canvas.width = canvas.height = 0;

          const pageWords = collectWords(result.data).map((w) => ({ ...w, page: i }));
          words.push(...pageWords);
          textParts.push({ page: i, text: result.data.text || pageWords.map((w) => w.text).join(' ') });
          scanned.push({ page: i, count: pageWords.length });
        }

        await worker.terminate();
        viewer.destroy();

        if (!words.length && !textParts.some((t) => t.text.trim())) {
          throw new Error('No text was recognised. Check the language setting, or try a higher reading resolution.');
        }

        const outputs = [];
        const allText = textParts.map((t) => `——— page ${t.page + 1} ———\n\n${t.text.trim()}`).join('\n\n');

        if (v.output !== 'pdf') {
          outputs.push({
            name: `${stem(file.name)}-text.txt`,
            blob: new Blob([allText], { type: 'text/plain;charset=utf-8' }),
            note: `${allText.length} characters`,
          });
        }

        if (v.output !== 'text') {
          await a.progress(0.9, 'Writing the text layer…');
          await writeTextLayer(doc, words, scale);
          outputs.push({
            name: `${stem(file.name)}-searchable.pdf`,
            data: await saveDoc(doc),
            note: `${plural(words.length, 'word')} over ${plural(scanned.length, 'page')}`,
          });
        }

        await a.done(outputs, { zipName: `${stem(file.name)}-ocr.zip` });
        a.status(`${plural(words.length, 'word')} recognised across ${plural(scanned.length, 'page')} · ${fmtBytes(allText.length)} of text`);
      } catch (err) {
        try { await worker.terminate(); } catch { /* already gone */ }
        throw err;
      }
    },
  });

  wb.panelBody.prepend(h('div.notice.notice--info', { style: { marginBottom: '.2rem' } }, [
    icon('shield', 15),
    h('div', 'The recognition engine runs here, in a worker thread. Page images are never sent anywhere.'),
  ]));

  return wb;
}

/** Walk the block tree Tesseract returns and flatten it to positioned words. */
function collectWords(data) {
  const out = [];
  const push = (word) => {
    const text = String(word.text || '').trim();
    if (!text || !word.bbox) return;
    if ((word.confidence ?? 100) < 30) return;
    out.push({ text, bbox: word.bbox });
  };
  if (Array.isArray(data.blocks)) {
    for (const block of data.blocks) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          for (const word of line.words || []) push(word);
        }
      }
    }
  }
  if (!out.length && Array.isArray(data.words)) data.words.forEach(push);
  return out;
}

/**
 * Lay the recognised words over the page in text rendering mode 3, which the
 * PDF specification defines as "fill nothing" — the words are selectable and
 * searchable but leave no marks.
 */
async function writeTextLayer(doc, words, scale) {
  const { degrees, setTextRenderingMode, TextRenderingMode } = await pdflib();
  const sample = words.map((w) => w.text).join('');
  const { font } = await embedFont(doc, 'noto-sans', { text: sample });
  const pages = doc.getPages();

  const byPage = new Map();
  for (const word of words) {
    if (!byPage.has(word.page)) byPage.set(word.page, []);
    byPage.get(word.page).push(word);
  }

  for (const [index, list] of byPage) {
    const page = pages[index];
    if (!page) continue;
    const rotate = degrees(pageAngle(page));
    const visualHeight = pageAngle(page) % 180 === 0 ? page.getSize().height : page.getSize().width;

    page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));

    for (const word of list) {
      const [x0, y0, x1, y1] = [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1];
      const boxW = (x1 - x0) / scale;
      const boxH = (y1 - y0) / scale;
      if (boxW <= 0 || boxH <= 0) continue;

      // Canvas y grows downwards; visual PDF y grows upwards.
      const vx = x0 / scale;
      const vy = visualHeight - (y1 / scale);

      let size = boxH * 0.86;
      const unit = safeWidth(font, word.text, 1);
      if (unit > 0) size = Math.min(boxW / unit, boxH * 1.4);
      if (!(size > 0.5)) continue;

      const p = toUser(page, vx, vy + boxH * 0.15);
      try {
        page.drawText(word.text, { x: p.x, y: p.y, size, font, rotate, opacity: 1 });
      } catch { /* a glyph the font cannot draw — skip that word */ }
    }
  }
}

function safeWidth(font, text, size) {
  try { return font.widthOfTextAtSize(text, size); } catch { return 0; }
}
