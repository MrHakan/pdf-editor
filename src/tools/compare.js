import { workbench } from '../ui/workbench.js';
import { openViewer, renderPage } from '../core/pdf.js';
import { h, clear, icon, plural } from '../ui/kit.js';
import { canvasToBlob } from '../core/files.js';

/**
 * Compare two versions of a document.
 *
 * Two passes: pixels, by rendering both pages at the same scale and diffing
 * them, and words, by reading both text layers and running a line-level diff.
 * The pixel pass catches moved images and layout shifts the text pass cannot.
 */
export default function mount(host, tool) {
  let results = null;
  let pages = [];

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: true,
    min: 2,
    max: 2,
    action: 'Compare them',
    actionIcon: 'compare',
    dropTitle: 'Choose the two PDFs to compare',
    dropHint: 'The first is treated as the original, the second as the revision',

    stage(a, stageEl) {
      results = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '.8rem' } });
      stageEl.append(
        h('div.stage__toolbar', [
          h('span.eyebrow', a.files.length === 2 ? `${a.files[0].name} → ${a.files[1].name}` : 'Two files needed'),
          h('span.spacer'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => a.pickFiles() }, 'Change files'),
          h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => a.clearFiles() }, 'Clear'),
        ]),
        results,
      );
      if (pages.length) drawResults();
    },

    fields: [
      {
        name: 'mode', type: 'segmented', label: 'Show', value: 'overlay',
        options: [
          { value: 'overlay', label: 'Overlay', title: 'Removed in red, added in cyan' },
          { value: 'heat', label: 'Changes only', title: 'Only the pixels that differ' },
        ],
      },
      { name: 'dpi', type: 'select', label: 'Comparison detail', value: '110', options: [
        { value: '72', label: 'Fast — 72 dpi' },
        { value: '110', label: 'Normal — 110 dpi' },
        { value: '160', label: 'Fine — 160 dpi' },
      ] },
      { name: 'threshold', type: 'range', label: 'Ignore differences under', value: 12, min: 0, max: 60, step: 1, suffix: ' / 255', hint: 'Raise it when scanning noise shows up as a change.' },
      { name: 'text', type: 'checkbox', label: 'Also compare the text', value: true, hint: 'Lists the lines that were added or removed.' },
      { name: 'onlyChanged', type: 'checkbox', label: 'Skip identical pages', value: true },
    ],

    validate(a) { return a.files.length === 2 ? null : 'Choose exactly two PDFs.'; },

    async run(a) {
      const v = a.values;
      const [fileA, fileB] = a.files;
      const docA = await openViewer(fileA);
      const docB = await openViewer(fileB);
      const scale = Number(v.dpi) / 72;
      const count = Math.max(docA.numPages, docB.numPages);
      pages = [];

      for (let i = 0; i < count; i++) {
        await a.progress(i / count, `Comparing page ${i + 1} of ${count}…`);
        const canvasA = i < docA.numPages ? await renderAt(docA, i, scale) : null;
        const canvasB = i < docB.numPages ? await renderAt(docB, i, scale) : null;

        if (!canvasA || !canvasB) {
          pages.push({ index: i, missing: canvasA ? 'second' : 'first', ratio: 1, canvas: canvasA || canvasB });
          continue;
        }

        const { canvas, changed, total } = diffCanvases(canvasA, canvasB, Number(v.threshold), v.mode);
        const ratio = total ? changed / total : 0;
        let lines = null;
        if (v.text) lines = await diffText(docA, docB, i);
        pages.push({ index: i, ratio, canvas, lines });
        canvasA.width = canvasA.height = 0;
        canvasB.width = canvasB.height = 0;
      }

      docA.destroy();
      docB.destroy();

      const changedPages = pages.filter((p) => p.ratio > 0.0002 || p.missing);
      drawResults(v.onlyChanged ? changedPages : pages);

      await a.progress(0.96, 'Building the report…');
      const outputs = [];
      for (const page of changedPages.slice(0, 40)) {
        if (!page.canvas) continue;
        const blob = await canvasToBlob(page.canvas, 'image/png');
        outputs.push({ name: `diff-page-${String(page.index + 1).padStart(3, '0')}.png`, blob, note: `${(page.ratio * 100).toFixed(2)}% of pixels differ` });
      }

      if (!changedPages.length) {
        a.status('The two documents render identically.');
        a.toast('No differences found.', 'ok');
        return;
      }
      await a.done(outputs, { zipName: 'comparison.zip', autoSave: outputs.length > 0 });
      a.status(`${plural(changedPages.length, 'page')} differ out of ${count}`);
    },
  });

  function drawResults(list = pages) {
    if (!results) return;
    clear(results);
    if (!list.length) { results.append(h('div.notice', [icon('check', 15), h('div', 'Nothing to show yet — run the comparison.')])); return; }

    for (const page of list) {
      const head = h('div.stage__toolbar', [
        h('span.eyebrow', `Page ${page.index + 1}`),
        h('span.spacer'),
        h('span.stage__hint', page.missing ? `Only in the ${page.missing === 'first' ? 'second' : 'first'} file` : `${(page.ratio * 100).toFixed(2)}% of pixels differ`),
      ]);
      const holder = h('div.sheet-holder');
      if (page.canvas) { page.canvas.style.maxWidth = '100%'; page.canvas.style.height = 'auto'; holder.append(page.canvas); }

      const block = h('div', { style: { border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', padding: '.6rem', background: 'var(--bg-2)' } }, [head, h('div.canvas-wrap', { style: { minHeight: 'auto' } }, holder)]);

      if (page.lines?.length) {
        const lineList = h('div', { style: { fontFamily: 'var(--mono)', fontSize: '11.5px', lineHeight: '1.6', marginTop: '.5rem', maxHeight: '190px', overflow: 'auto' } });
        for (const line of page.lines.slice(0, 60)) {
          lineList.append(h('div', {
            style: {
              color: line.added ? 'var(--ok)' : 'var(--danger)',
              background: `color-mix(in srgb, ${line.added ? 'var(--ok)' : 'var(--danger)'} 8%, transparent)`,
              padding: '.1rem .35rem', borderRadius: '2px', whiteSpace: 'pre-wrap',
            },
          }, `${line.added ? '+' : '−'} ${line.text}`));
        }
        block.append(lineList);
      }
      results.append(block);
    }
  }
}

async function renderAt(doc, index, scale) {
  const page = await doc.getPage(index + 1);
  const canvas = await renderPage(page, scale);
  page.cleanup();
  return canvas;
}

/** Red where the original had ink, cyan where the revision does. */
function diffCanvases(a, b, threshold, mode) {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const pixelsA = padded(a, width, height);
  const pixelsB = padded(b, width, height);
  const result = ctx.createImageData(width, height);
  const d = result.data;
  let changed = 0;

  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    const lumA = (pixelsA[j] * 0.299 + pixelsA[j + 1] * 0.587 + pixelsA[j + 2] * 0.114);
    const lumB = (pixelsB[j] * 0.299 + pixelsB[j + 1] * 0.587 + pixelsB[j + 2] * 0.114);
    const delta = Math.abs(lumA - lumB);

    if (delta <= threshold) {
      if (mode === 'heat') { d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = 255; }
      else {
        const grey = 255 - (255 - Math.min(lumA, lumB)) * 0.22;
        d[j] = d[j + 1] = d[j + 2] = grey;
        d[j + 3] = 255;
      }
      continue;
    }
    changed++;
    if (lumA < lumB) { d[j] = 224; d[j + 1] = 69; d[j + 2] = 123; }  // was there, now gone
    else { d[j] = 34; d[j + 1] = 184; d[j + 2] = 214; }              // newly there
    d[j + 3] = 255;
  }

  ctx.putImageData(result, 0, 0);
  return { canvas: out, changed, total: width * height };
}

function padded(canvas, width, height) {
  const tmp = document.createElement('canvas');
  tmp.width = width;
  tmp.height = height;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(canvas, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}

async function diffText(docA, docB, index) {
  const [linesA, linesB] = await Promise.all([textLines(docA, index), textLines(docB, index)]);
  const setA = new Map();
  linesA.forEach((l) => setA.set(l, (setA.get(l) || 0) + 1));
  const out = [];
  for (const line of linesB) {
    const n = setA.get(line) || 0;
    if (n > 0) setA.set(line, n - 1);
    else out.push({ added: true, text: line });
  }
  for (const [line, n] of setA) for (let i = 0; i < n; i++) out.push({ added: false, text: line });
  return out;
}

async function textLines(doc, index) {
  if (index >= doc.numPages) return [];
  const page = await doc.getPage(index + 1);
  const content = await page.getTextContent();
  const rows = new Map();
  for (const item of content.items) {
    if (!item.str?.trim()) continue;
    const y = Math.round(item.transform[5]);
    rows.set(y, (rows.get(y) || '') + item.str);
  }
  page.cleanup();
  return Array.from(rows.values()).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
