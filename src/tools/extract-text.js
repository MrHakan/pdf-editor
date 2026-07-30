import { workbench } from '../ui/workbench.js';
import { openViewer } from '../core/pdf.js';
import { checkRange, parseRange } from '../core/range.js';
import { pad, safeName } from '../core/files.js';
import { stem, plural, h } from '../ui/kit.js';

export default function mount(host, tool) {
  let total = 0;
  let preview = null;

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Extract the text',
    actionIcon: 'extractText',
    dropTitle: 'Choose a PDF, or drop it here',
    plainStage: true,

    async onFiles(a) {
      total = 0;
      if (!a.files[0]) return;
      const viewer = await openViewer(a.files[0]);
      total = viewer.numPages;
      const sample = await pageText(viewer, 1, { paragraphs: true });
      viewer.destroy();
      a.renderStage();
      if (preview) {
        preview.value = sample.text || '';
        if (!sample.text.trim()) a.toast('There is no text layer on page 1 — this looks like a scan. Try Make searchable first.', 'error');
      }
      a.refreshFields();
    },

    stage(a, stageEl) {
      preview = h('textarea', {
        readonly: true, spellcheck: 'false',
        style: {
          flex: '1', minHeight: '380px', width: '100%', background: 'var(--bg-3)', color: 'var(--text-2)',
          border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', padding: '.9rem 1rem',
          fontFamily: 'var(--mono)', fontSize: '12.5px', lineHeight: '1.6', resize: 'vertical',
        },
      });
      stageEl.append(
        h('div.stage__toolbar', [
          h('span.eyebrow', 'Page 1 preview'),
          h('span.spacer'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => a.pickFiles() }, 'Replace file'),
        ]),
        preview,
      );
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
        name: 'layout', type: 'segmented', label: 'Line handling', value: 'paragraphs',
        options: [
          { value: 'paragraphs', label: 'Paragraphs', title: 'Rejoin wrapped lines into paragraphs' },
          { value: 'lines', label: 'Keep lines', title: 'One output line per line on the page' },
        ],
      },
      { name: 'headers', type: 'checkbox', label: 'Mark page boundaries', value: true, hint: 'Writes a "— page 4 —" rule between pages.' },
      { name: 'split', type: 'checkbox', label: 'One file per page', value: false },
      {
        name: 'format', type: 'segmented', label: 'File type', value: 'txt',
        options: [{ value: 'txt', label: '.txt' }, { value: 'md', label: '.md' }],
      },
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
      const base = safeName(stem(file.name));
      const ext = v.format;
      const paragraphs = v.layout === 'paragraphs';

      const perPage = [];
      let empty = 0;

      for (let i = 0; i < wanted.length; i++) {
        const n = wanted[i];
        if (i % 4 === 0) await a.progress(i / wanted.length, `Reading page ${n + 1}…`);
        const { text } = await pageText(viewer, n + 1, { paragraphs });
        if (!text.trim()) empty++;
        perPage.push({ n, text });
      }
      viewer.destroy();

      if (empty === wanted.length) throw new Error('No text layer found on any of those pages. If this is a scan, run Make searchable first.');
      if (empty) a.toast(`${plural(empty, 'page')} had no text layer and came out blank.`);

      if (v.split) {
        const outputs = perPage.map(({ n, text }) => ({
          name: `${base}-${pad(n + 1, viewer.numPages)}.${ext}`,
          blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
          note: `${text.length} characters`,
        }));
        await a.done(outputs, { zipName: `${base}-text.zip` });
        return;
      }

      const joined = perPage.map(({ n, text }) => {
        if (!v.headers) return text;
        return ext === 'md' ? `\n\n## Page ${n + 1}\n\n${text}` : `\n\n——— page ${n + 1} ———\n\n${text}`;
      }).join('\n').trim() + '\n';

      if (preview) preview.value = joined.slice(0, 20000);
      await a.done([{
        name: `${base}.${ext}`,
        blob: new Blob([joined], { type: 'text/plain;charset=utf-8' }),
        note: `${plural(wanted.length, 'page')} · ${joined.length} characters`,
      }]);
    },
  });
}

/**
 * PDF text comes back as positioned fragments, not lines. Group them by
 * baseline, sort left to right, and infer word gaps from the geometry.
 */
async function pageText(viewer, pageNo, { paragraphs }) {
  const page = await viewer.getPage(pageNo);
  const content = await page.getTextContent();
  const rows = [];

  for (const item of content.items) {
    if (!item.str) continue;
    const [, , , , x, y] = item.transform;
    const height = Math.abs(item.transform[3]) || 10;
    let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(1.5, height * 0.4));
    if (!row) { row = { y, height, items: [] }; rows.push(row); }
    row.items.push({ x, width: item.width || 0, str: item.str, space: item.hasEOL });
  }

  rows.sort((a, b) => b.y - a.y);
  const lines = rows.map((row) => {
    row.items.sort((a, b) => a.x - b.x);
    let text = '';
    let cursor = null;
    for (const it of row.items) {
      if (cursor !== null) {
        const gap = it.x - cursor;
        if (gap > row.height * 0.22 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
      }
      text += it.str;
      cursor = it.x + it.width;
    }
    return { text: text.replace(/\s+/g, ' ').trim(), y: row.y, height: row.height };
  }).filter((l) => l.text);

  page.cleanup();

  if (!paragraphs) return { text: lines.map((l) => l.text).join('\n') };

  // Rejoin wrapped lines: a normal line gap continues the paragraph, a larger
  // one or a line ending in sentence punctuation starts a new block.
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1];
    out += line.text;
    if (!next) break;
    const gap = line.y - next.y;
    const newBlock = gap > line.height * 1.75 || /[.!?:;]["')\]]?$/.test(line.text) && gap > line.height * 1.3;
    if (newBlock) out += '\n\n';
    else if (/[-‐‑‒–]$/.test(line.text)) out = out.slice(0, -1);
    else out += ' ';
  }
  return { text: out.replace(/\n{3,}/g, '\n\n') };
}
