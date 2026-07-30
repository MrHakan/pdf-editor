import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { saveDoc, PAGE_SIZES } from '../core/pdf.js';
import { embedFont, fontOptions } from '../core/fonts.js';
import { hexColor, mm } from '../core/geometry.js';
import { h, stem, plural } from '../ui/kit.js';

/**
 * Typesets plain text or a Markdown subset. Layout is done here rather than by
 * a rendering engine, so it stays predictable: measure, wrap, break, draw.
 */
export default function mount(host, tool) {
  let text = '';
  let editor = null;

  workbench(host, tool, {
    accept: '.txt,.md,.markdown,.text,text/plain,text/markdown',
    multiple: false,
    noFiles: true,
    action: 'Typeset the PDF',
    actionIcon: 'textToPdf',
    plainStage: true,

    async onFiles(a) {
      if (!a.files[0]) return;
      text = await a.files[0].text();
      if (editor) editor.value = text;
      a.status(`Loaded ${a.files[0].name}`);
    },

    stage(a, stageEl) {
      editor = h('textarea', {
        spellcheck: 'false',
        placeholder: '# A heading\n\nWrite or paste here. Markdown basics work:\n\n- bullet lists\n- **bold** and *italic*\n- `code` and fenced blocks\n\n> A quoted line.\n',
        oninput: (e) => { text = e.target.value; updateCount(); },
        style: {
          flex: '1', minHeight: '380px', width: '100%', resize: 'vertical',
          background: 'var(--bg-3)', color: 'var(--text)', border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-sm)', padding: '.9rem 1rem', fontFamily: 'var(--mono)',
          fontSize: '13px', lineHeight: '1.65',
        },
      });
      editor.value = text;

      const count = h('span.stage__hint');
      const updateCount = () => {
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        count.textContent = `${plural(words, 'word')} · ${plural(text.length, 'character')}`;
        a.enableRun(Boolean(text.trim()));
      };

      stageEl.append(
        h('div.stage__toolbar', [
          h('button.btn.btn--sm', { type: 'button', onclick: () => a.pickFiles() }, 'Open a .txt or .md file'),
          h('button.btn.btn--sm', { type: 'button', onclick: async () => { try { editor.value = text = await navigator.clipboard.readText(); updateCount(); } catch { a.toast('Your browser would not share the clipboard. Paste with Ctrl+V instead.', 'error'); } } }, 'Paste'),
          h('span.spacer'),
          count,
          h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => { editor.value = text = ''; updateCount(); } }, 'Clear'),
        ]),
        editor,
      );
      updateCount();
    },

    fields: [
      { name: 'markdown', type: 'checkbox', label: 'Read it as Markdown', value: true, hint: 'Off means every line is typeset exactly as written.' },
      { name: 'size', type: 'select', label: 'Page size', value: 'a4', options: Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label })) },
      { name: 'orientation', type: 'segmented', label: 'Orientation', value: 'portrait', options: [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] },
      { name: 'font', type: 'select', label: 'Typeface', value: 'noto-sans', options: fontOptions, hint: 'The Noto faces cover Turkish, Greek, Cyrillic and more.' },
      { name: 'fontSize', type: 'range', label: 'Body size', value: 11, min: 7, max: 20, step: 0.5, suffix: ' pt' },
      { name: 'leading', type: 'range', label: 'Line spacing', value: 1.5, min: 1, max: 2.4, step: 0.05, format: (v) => `${v}×` },
      { name: 'margin', type: 'range', label: 'Margin', value: 20, min: 8, max: 45, step: 1, suffix: ' mm' },
      { name: 'align', type: 'segmented', label: 'Alignment', value: 'left', options: [{ value: 'left', label: 'Left' }, { value: 'justify', label: 'Justify' }] },
      { name: 'ink', type: 'color', label: 'Text colour', value: '#16181d' },
      { name: 'numbers', type: 'checkbox', label: 'Number the pages', value: true },
      { name: 'outName', type: 'text', label: 'Save as', value: 'document.pdf' },
    ],

    validate() { return text.trim() ? null : 'Write or paste some text first.'; },

    async run(a) {
      const { PDFDocument } = await pdflib();
      const v = a.values;
      const doc = await PDFDocument.create();

      const base = PAGE_SIZES[v.size];
      const pageW = v.orientation === 'landscape' ? base.h : base.w;
      const pageH = v.orientation === 'landscape' ? base.w : base.h;
      const margin = mm(v.margin);
      const maxWidth = pageW - margin * 2;
      const ink = await hexColor(v.ink);

      await a.progress(0.15, 'Embedding fonts…');
      const [regular, bold, italic, mono] = await Promise.all([
        embedFont(doc, v.font, { text }),
        embedFont(doc, v.font, { bold: true, text }),
        embedFont(doc, v.font, { italic: true, text }),
        embedFont(doc, 'noto-mono', { text }),
      ]);
      const fonts = { regular: regular.font, bold: bold.font, italic: italic.font, mono: mono.font };
      if (regular.substituted) a.toast(`${regular.substituted.from} cannot draw every character here, so ${regular.substituted.to} was used.`);

      const blocks = v.markdown ? parseMarkdown(text) : text.split(/\r?\n/).map((line) => ({ type: 'p', runs: [{ text: line }] }));

      await a.progress(0.4, 'Laying out…');
      const size = Number(v.fontSize);
      const leading = size * Number(v.leading);

      let page = doc.addPage([pageW, pageH]);
      let y = pageH - margin;
      const pages = [page];

      const newPage = () => { page = doc.addPage([pageW, pageH]); pages.push(page); y = pageH - margin; };
      const room = (needed) => { if (y - needed < margin) newPage(); };

      for (const block of blocks) {
        if (block.type === 'hr') {
          room(leading);
          y -= leading * 0.55;
          page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.6, color: ink, opacity: 0.28 });
          y -= leading * 0.55;
          continue;
        }
        if (block.type === 'blank') { y -= leading * 0.6; continue; }

        const style = blockStyle(block, size, fonts);
        const indent = (block.indent || 0) * size * 1.05 + (block.type === 'quote' ? size * 0.9 : 0);
        const bulletWidth = block.marker ? style.font.widthOfTextAtSize(`${block.marker} `, style.size) : 0;
        const width = maxWidth - indent - bulletWidth;

        if (block.spaceBefore) y -= leading * block.spaceBefore;

        if (block.type === 'code') {
          const lineHeight = size * 1.4;
          for (const line of block.lines) {
            room(lineHeight);
            // Tint sits behind each line so a block can break across pages cleanly.
            page.drawRectangle({ x: margin, y: y - lineHeight + size * 0.32, width: maxWidth, height: lineHeight, color: ink, opacity: 0.05 });
            page.drawText(safe(fonts.mono, line), { x: margin + size * 0.7, y: y - size, size: size * 0.92, font: fonts.mono, color: ink });
            y -= lineHeight;
          }
          y -= leading * 0.3;
          continue;
        }

        const lines = layoutRuns(block.runs, fonts, style, width);
        for (let i = 0; i < lines.length; i++) {
          const lineHeight = style.leading ?? leading * style.scale;
          room(lineHeight);
          const isLast = i === lines.length - 1;
          let x = margin + indent + bulletWidth;

          if (i === 0 && block.marker) {
            page.drawText(safe(style.font, block.marker), { x: margin + indent, y: y - style.size, size: style.size, font: style.font, color: ink });
          }
          if (block.type === 'quote') {
            page.drawRectangle({ x: margin + indent - size * 0.9, y: y - style.size - style.size * 0.28, width: 2, height: lineHeight, color: ink, opacity: 0.3 });
          }

          const extra = v.align === 'justify' && !isLast && lines.length > 1 && block.type === 'p'
            ? (width - lines[i].width) / Math.max(1, lines[i].gaps)
            : 0;

          for (const run of lines[i].runs) {
            const font = pickFont(run, fonts, style);
            page.drawText(safe(font, run.text), { x, y: y - style.size, size: style.size, font, color: ink });
            x += font.widthOfTextAtSize(run.text, style.size) + (run.trailingSpaces || 0) * extra;
          }

          y -= lineHeight;
          // Rule under the top two heading levels, clear of the descenders.
          if (block.type === 'h' && block.level <= 2 && i === lines.length - 1) {
            y -= style.size * 0.16;
            page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.6, color: ink, opacity: 0.18 });
            y -= style.size * 0.12;
          }
        }
        if (block.spaceAfter) y -= leading * block.spaceAfter;
      }

      if (v.numbers) {
        await a.progress(0.85, 'Numbering…');
        pages.forEach((p, i) => {
          const label = `${i + 1}`;
          const w = fonts.regular.widthOfTextAtSize(label, size * 0.82);
          p.drawText(label, { x: (pageW - w) / 2, y: margin * 0.45, size: size * 0.82, font: fonts.regular, color: ink, opacity: 0.55 });
        });
      }

      const title = blocks.find((b) => b.type === 'h')?.runs?.map((r) => r.text).join('') || stem(v.outName || 'document');
      doc.setTitle(title);
      doc.setProducer('Quire');
      doc.setCreator('Quire');

      await a.progress(0.95, 'Saving…');
      const name = (v.outName || 'document.pdf').replace(/(\.pdf)?$/i, '.pdf');
      await a.done([{ name, data: await saveDoc(doc), note: plural(pages.length, 'page') }]);
    },
  });
}

/* ---- Markdown ------------------------------------------------------------
   A deliberately small subset: headings, lists, quotes, rules, fenced code and
   inline emphasis. Anything it does not recognise is typeset as written.
   ------------------------------------------------------------------------- */
function parseMarkdown(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = null;
  const flush = () => { if (para) { blocks.push(para); para = null; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*```/.exec(line);
    if (fence) {
      flush();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      blocks.push({ type: 'code', lines: code, spaceBefore: 0.4, spaceAfter: 0.4 });
      continue;
    }

    if (!line.trim()) { flush(); blocks.push({ type: 'blank' }); continue; }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flush(); blocks.push({ type: 'hr', spaceBefore: 0.3, spaceAfter: 0.3 }); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'h', level: heading[1].length, runs: inline(heading[2]), spaceBefore: heading[1].length <= 2 ? 0.9 : 0.6, spaceAfter: 0.35 });
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { flush(); blocks.push({ type: 'quote', runs: inline(quote[1]), spaceAfter: 0.15 }); continue; }

    const bullet = /^(\s*)([-*+])\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      blocks.push({ type: 'li', indent: Math.floor(bullet[1].length / 2) + 1, marker: '•', runs: inline(bullet[3]) });
      continue;
    }

    const numbered = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      blocks.push({ type: 'li', indent: Math.floor(numbered[1].length / 2) + 1, marker: `${numbered[2]}.`, runs: inline(numbered[3]) });
      continue;
    }

    if (para) para.runs.push({ text: ' ' }, ...inline(line));
    else para = { type: 'p', runs: inline(line), spaceAfter: 0.3 };
  }
  flush();
  return blocks;
}

/** Split a line into styled runs. */
function inline(text) {
  const runs = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true });
    else if (m[4] !== undefined) runs.push({ text: m[4], italic: true });
    else if (m[5] !== undefined) runs.push({ text: m[5], code: true });
    else if (m[6] !== undefined) runs.push({ text: m[6], link: m[7] });
    last = re.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.length ? runs : [{ text }];
}

function blockStyle(block, size, fonts) {
  if (block.type === 'h') {
    const scale = [2.0, 1.62, 1.32, 1.14, 1.02, 0.94][block.level - 1] || 1;
    return { size: size * scale, font: fonts.bold, scale, leading: size * scale * 1.22, bold: true };
  }
  return { size, font: fonts.regular, scale: 1 };
}

function pickFont(run, fonts, style) {
  if (run.code) return fonts.mono;
  if (style.bold || run.bold) return run.italic && !style.bold ? fonts.italic : fonts.bold;
  if (run.italic) return fonts.italic;
  return style.font;
}

/** Wrap styled runs into lines, keeping the styling. */
function layoutRuns(runs, fonts, style, maxWidth) {
  const lines = [];
  let current = { runs: [], width: 0, gaps: 0 };

  const pushLine = () => {
    while (current.runs.length && /^\s*$/.test(current.runs[current.runs.length - 1].text)) current.runs.pop();
    lines.push(current);
    current = { runs: [], width: 0, gaps: 0 };
  };

  for (const run of runs) {
    const font = pickFont(run, fonts, style);
    const pieces = String(run.text).split(/(\s+)/).filter((p) => p !== '');
    for (const piece of pieces) {
      const w = font.widthOfTextAtSize(piece, style.size);
      if (current.width + w > maxWidth && current.runs.length && piece.trim()) pushLine();
      if (!current.runs.length && !piece.trim()) continue;
      const prev = current.runs[current.runs.length - 1];
      if (prev && sameStyle(prev, run)) { prev.text += piece; }
      else current.runs.push({ ...run, text: piece });
      current.width += w;
      if (!piece.trim()) current.gaps += 1;
    }
  }
  pushLine();

  // Record how many spaces trail each run, for justification.
  for (const line of lines) {
    line.width = line.runs.reduce((sum, r) => sum + pickFont(r, fonts, style).widthOfTextAtSize(r.text, style.size), 0);
    line.gaps = line.runs.reduce((n, r) => n + (r.text.match(/\s/g) || []).length, 0);
    line.runs.forEach((r) => { r.trailingSpaces = (r.text.match(/\s+$/)?.[0].length) || 0; });
  }
  return lines.length ? lines : [{ runs: [], width: 0, gaps: 0 }];
}

const sameStyle = (a, b) => Boolean(a.bold) === Boolean(b.bold) && Boolean(a.italic) === Boolean(b.italic) && Boolean(a.code) === Boolean(b.code);

/** Drop anything the chosen face cannot draw rather than failing the job. */
function safe(font, text) {
  const clean = String(text).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  try { font.widthOfTextAtSize(clean, 10); return clean; }
  catch {
    return Array.from(clean).map((ch) => {
      try { font.widthOfTextAtSize(ch, 10); return ch; } catch { return ch.trim() ? '·' : ch; }
    }).join('');
  }
}
