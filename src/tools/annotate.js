import { workbench } from '../ui/workbench.js';
import { canvasStage } from '../ui/canvasstage.js';
import { pdflib } from '../core/lib.js';
import { openDoc, saveDoc } from '../core/pdf.js';
import { embedFont, fontOptions, wrapText } from '../core/fonts.js';
import { toUser, pageAngle, hexColor } from '../core/geometry.js';
import { loadImage, canvasToBlob, pickFiles } from '../core/files.js';
import { h, clear, icon, stem, plural } from '../ui/kit.js';

const MODES = [
  { id: 'select', label: 'Select', icon: 'cursor' },
  { id: 'text', label: 'Text', icon: 'type' },
  { id: 'box', label: 'Box', icon: 'square' },
  { id: 'highlight', label: 'Highlight', icon: 'watermark' },
  { id: 'ink', label: 'Draw', icon: 'pen' },
  { id: 'image', label: 'Image', icon: 'imagesToPdf' },
];

export default function mount(host, tool) {
  let stage = null;
  let mode = 'text';
  let values = {};
  const inspector = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '.6rem' } });

  const wb = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Write the marks in',
    actionIcon: 'annotate',
    dropTitle: 'Choose a PDF to mark up, or drop it here',
    dropHint: 'Click the page to place text, drag to draw a box',

    async onFiles(a) {
      values = a.values;
      if (!a.files[0]) { stage?.destroy(); stage = null; return; }
      a.renderStage();
      await stage.setFile(a.files[0]);
    },

    stage(a, stageEl) {
      values = a.values;
      if (!stage) stage = buildStage(a);
      const bar = h('div.stage__toolbar', [
        h('div.segmented', { style: { gridAutoFlow: 'column' } }, MODES.map((m) => {
          const b = h('button', { type: 'button', 'aria-pressed': String(m.id === mode), title: m.label, onclick: () => setMode(m.id, bar) }, [icon(m.icon, 13), m.label]);
          b.style.display = 'flex';
          b.style.alignItems = 'center';
          b.style.gap = '.3rem';
          return b;
        })),
        h('span.spacer'),
        h('button.btn.btn--sm', { type: 'button', onclick: () => stage.clearPage() }, 'Clear page'),
        h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: () => stage.clearAll() }, 'Clear all'),
        stage.pager,
      ]);
      stageEl.append(bar, stage.el, h('p.stage__hint', 'Drag on the page to place something. Click a mark to select it, then drag it, pull its corner, or edit it in the panel.'));
      if (a.files[0] && !stage.pageCount) stage.setFile(a.files[0]);

      function setMode(id, barEl) {
        mode = id;
        barEl.querySelectorAll('.segmented button').forEach((b, i) => b.setAttribute('aria-pressed', String(MODES[i].id === id)));
        stage.el.style.cursor = id === 'select' ? 'default' : 'crosshair';
        if (id === 'image') chooseImage(a);
      }
    },

    fields: [
      { name: 'color', type: 'color', label: 'Colour', value: '#e0457b' },
      { name: 'fontSize', type: 'range', label: 'Text size', value: 14, min: 6, max: 72, step: 1, suffix: ' pt' },
      { name: 'font', type: 'select', label: 'Typeface', value: 'noto-sans', options: fontOptions },
      { name: 'bold', type: 'checkbox', label: 'Bold text', value: false },
      { name: 'strokeWidth', type: 'range', label: 'Line thickness', value: 2, min: 0.5, max: 12, step: 0.5, suffix: ' pt' },
      { name: 'fill', type: 'checkbox', label: 'Fill boxes', value: false },
      { name: 'opacity', type: 'range', label: 'Opacity', value: 100, min: 10, max: 100, step: 5, suffix: '%' },
      { name: 'note', type: 'note', kind: 'info', text: 'These settings apply to the next mark you add. Selecting an existing mark shows its own controls below.' },
    ],

    onFieldChange(a) { values = a.values; },

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      if (!stage?.items.length) return 'Nothing has been added to the page yet.';
      return null;
    },

    async run(a) {
      const file = a.files[0];
      const doc = await openDoc(file);
      const { degrees } = await pdflib();
      const pages = doc.getPages();
      const items = stage.items;

      // One font per (family, weight) pair, embedded once for the whole job.
      const fontCache = new Map();
      const getFont = async (family, bold, text) => {
        const key = `${family}|${bold}`;
        if (!fontCache.has(key)) fontCache.set(key, embedFont(doc, family, { bold, text }));
        return (await fontCache.get(key)).font;
      };
      const imageCache = new Map();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        await a.progress(i / items.length, `Mark ${i + 1} of ${items.length}…`);
        const page = pages[item.page];
        if (!page) continue;
        const rotate = degrees(pageAngle(page));
        const colour = await hexColor(item.color);
        const opacity = (item.opacity ?? 100) / 100;

        if (item.kind === 'text') {
          const font = await getFont(item.font, item.bold, item.text);
          const lines = wrapText(font, item.text, item.size, item.w);
          let cursor = item.y + item.h - item.size;
          for (const line of lines) {
            const p = toUser(page, item.x, cursor);
            page.drawText(line, { x: p.x, y: p.y, size: item.size, font, color: colour, rotate, opacity });
            cursor -= item.size * 1.25;
          }
        } else if (item.kind === 'box') {
          const p = toUser(page, item.x, item.y);
          page.drawRectangle({
            x: p.x, y: p.y, width: item.w, height: item.h, rotate,
            borderColor: colour, borderWidth: item.strokeWidth,
            color: item.fill ? colour : undefined,
            opacity: item.fill ? opacity : undefined,
            borderOpacity: opacity,
          });
        } else if (item.kind === 'highlight') {
          const p = toUser(page, item.x, item.y);
          page.drawRectangle({ x: p.x, y: p.y, width: item.w, height: item.h, rotate, color: colour, opacity: Math.min(0.6, opacity) });
        } else if (item.kind === 'ink') {
          for (let k = 1; k < item.points.length; k++) {
            const a1 = toUser(page, item.points[k - 1].x, item.points[k - 1].y);
            const b1 = toUser(page, item.points[k].x, item.points[k].y);
            page.drawLine({ start: a1, end: b1, thickness: item.strokeWidth, color: colour, opacity, lineCap: 1 });
          }
        } else if (item.kind === 'image') {
          if (!imageCache.has(item.src)) imageCache.set(item.src, await embedAny(doc, item.blob));
          const image = await imageCache.get(item.src);
          const p = toUser(page, item.x, item.y);
          page.drawImage(image, { x: p.x, y: p.y, width: item.w, height: item.h, rotate, opacity });
        }
      }

      await a.progress(0.92, 'Saving…');
      await a.done([{ name: `${stem(file.name)}-marked.pdf`, data: await saveDoc(doc), note: `${plural(items.length, 'mark')} added` }]);
    },
  });

  wb.panelBody.append(inspector);

  function buildStage(a) {
    const s = canvasStage({
      pen: () => mode === 'ink',
      penColor: () => values.color,
      penWidth: () => values.strokeWidth,
      onStroke: (points, page) => {
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        s.add({
          kind: 'ink', page, points,
          x: Math.min(...xs), y: Math.min(...ys),
          w: Math.max(1, Math.max(...xs) - Math.min(...xs)),
          h: Math.max(1, Math.max(...ys) - Math.min(...ys)),
          color: values.color, strokeWidth: Number(values.strokeWidth), opacity: Number(values.opacity),
        });
      },
      newItem: (rect) => {
        if (mode === 'select') return null;
        if (mode === 'image') { chooseImage(a, rect); return null; }
        const base = { ...rect, color: values.color, opacity: Number(values.opacity) };
        if (mode === 'text') {
          const size = Number(values.fontSize);
          return { ...base, kind: 'text', text: 'New note', size, font: values.font, bold: values.bold, w: Math.max(rect.w, size * 8), h: Math.max(rect.h, size * 1.4) };
        }
        // A stray click should not leave a two-point rectangle behind.
        if (rect.w < 10 || rect.h < 6) return null;
        if (mode === 'box') return { ...base, kind: 'box', strokeWidth: Number(values.strokeWidth), fill: values.fill };
        if (mode === 'highlight') return { ...base, kind: 'highlight', color: values.color, opacity: Math.min(60, Number(values.opacity)) };
        return null;
      },
      draw: (item, scale) => drawItem(item, scale),
      onSelect: (item) => showInspector(item, a),
    });
    return s;
  }

  async function chooseImage(a, rect) {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (!file) return;
    const img = await loadImage(file);
    const ratio = (img.height || img.naturalHeight) / (img.width || img.naturalWidth);
    img.close?.();
    const width = rect?.w || 160;
    stage.add({
      kind: 'image', page: rect?.page ?? stage.pageIndex,
      x: rect?.x ?? 60, y: rect?.y ?? 60,
      w: width, h: rect?.h || width * ratio,
      blob: file, src: URL.createObjectURL(file), opacity: Number(values.opacity),
    });
  }

  function drawItem(item, scale) {
    if (item.kind === 'text') {
      return h('div', {
        style: {
          width: '100%', height: '100%', overflow: 'hidden', color: item.color,
          fontSize: `${item.size * scale}px`, lineHeight: '1.25',
          fontWeight: item.bold ? '700' : '400', fontFamily: 'var(--sans)',
          opacity: String((item.opacity ?? 100) / 100), padding: '0', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        },
      }, item.text);
    }
    if (item.kind === 'box') {
      return h('div', { style: { width: '100%', height: '100%', border: `${Math.max(1, item.strokeWidth * scale)}px solid ${item.color}`, background: item.fill ? item.color : 'transparent', opacity: String((item.opacity ?? 100) / 100) } });
    }
    if (item.kind === 'highlight') {
      return h('div', { style: { width: '100%', height: '100%', background: item.color, opacity: String(Math.min(60, item.opacity ?? 40) / 100) } });
    }
    if (item.kind === 'image') {
      return h('img', { src: item.src, alt: '', style: { width: '100%', height: '100%', objectFit: 'fill', opacity: String((item.opacity ?? 100) / 100) } });
    }
    if (item.kind === 'ink') {
      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      Object.assign(svgEl.style, { width: '100%', height: '100%', overflow: 'visible' });
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const d = item.points.map((p, i) => `${i ? 'L' : 'M'}${((p.x - item.x) * scale).toFixed(1)},${((item.y + item.h - p.y) * scale).toFixed(1)}`).join(' ');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', item.color);
      path.setAttribute('stroke-width', String(item.strokeWidth * scale));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svgEl.append(path);
      return svgEl;
    }
    return null;
  }

  function showInspector(item) {
    clear(inspector);
    if (!item) return;
    inspector.append(h('div.eyebrow', { style: { marginTop: '.4rem' } }, `Selected ${item.kind}`));

    if (item.kind === 'text') {
      const ta = h('textarea', { rows: 3, oninput: (e) => { item.text = e.target.value; stage.paint(); } });
      ta.value = item.text;
      inspector.append(h('label.field', [h('span.field__label', 'Wording'), ta]));
      inspector.append(numberField('Size', item.size, 6, 96, 1, (v) => { item.size = v; stage.paint(); }));
    }
    if (item.kind === 'box' || item.kind === 'ink') {
      inspector.append(numberField('Thickness', item.strokeWidth, 0.5, 20, 0.5, (v) => { item.strokeWidth = v; stage.paint(); }));
    }
    inspector.append(
      colourField('Colour', item.color, (v) => { item.color = v; stage.paint(); }),
      numberField('Opacity %', item.opacity ?? 100, 5, 100, 5, (v) => { item.opacity = v; stage.paint(); }),
      h('button.btn.btn--sm.btn--danger.btn--block', { type: 'button', onclick: () => stage.remove(item.id) }, [icon('trash', 13), 'Remove this mark']),
    );
  }

  return wb;
}

function numberField(label, value, min, max, step, onInput) {
  const out = h('span.field__val', String(value));
  return h('div.field', [
    h('span.field__label', [label, out]),
    h('input', { type: 'range', min, max, step, value, oninput: (e) => { out.textContent = e.target.value; onInput(Number(e.target.value)); } }),
  ]);
}

function colourField(label, value, onInput) {
  return h('div.field', [
    h('span.field__label', label),
    h('input', { type: 'color', value, oninput: (e) => onInput(e.target.value) }),
  ]);
}

async function embedAny(doc, file) {
  const isPng = /png$/i.test(file.type) || /\.png$/i.test(file.name);
  const isJpg = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
  if (isPng) return doc.embedPng(await file.arrayBuffer());
  if (isJpg) return doc.embedJpg(await file.arrayBuffer());
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width || img.naturalWidth;
  canvas.height = img.height || img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  const blob = await canvasToBlob(canvas, 'image/png');
  img.close?.();
  return doc.embedPng(await blob.arrayBuffer());
}
