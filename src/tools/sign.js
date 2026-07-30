import { workbench } from '../ui/workbench.js';
import { canvasStage } from '../ui/canvasstage.js';
import { pdflib } from '../core/lib.js';
import { openDoc, saveDoc } from '../core/pdf.js';
import { embedFont } from '../core/fonts.js';
import { toUser, pageAngle, hexColor } from '../core/geometry.js';
import { loadImage, canvasToBlob, pickFiles } from '../core/files.js';
import { h, clear, icon, stem, plural } from '../ui/kit.js';

/**
 * Sign a document.
 *
 * A signature is just a transparent PNG here — drawn, typed or brought in as a
 * file. It is kept in memory for the session so it can be stamped on several
 * pages, and written into the PDF as an image at the size and place you set.
 */
export default function mount(host, tool) {
  let stage = null;
  let signature = null;      // { blob, url, ratio, label }
  let values = {};
  const gallery = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '.5rem' } });

  const wb = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Sign and save',
    actionIcon: 'sign',
    dropTitle: 'Choose the PDF to sign, or drop it here',

    async onFiles(a) {
      values = a.values;
      if (!a.files[0]) { stage?.destroy(); stage = null; return; }
      a.renderStage();
      await stage.setFile(a.files[0]);
    },

    stage(a, stageEl) {
      values = a.values;
      if (!stage) stage = buildStage();
      stageEl.append(
        h('div.stage__toolbar', [
          h('span.stage__hint', signature ? 'Drag on the page to place your signature' : 'Make a signature in the panel first'),
          h('span.spacer'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => stage.clearPage() }, 'Clear page'),
          stage.pager,
        ]),
        stage.el,
      );
      if (a.files[0] && !stage.pageCount) stage.setFile(a.files[0]);
    },

    fields: [
      { name: 'heading', type: 'heading', label: 'Placement' },
      { name: 'width', type: 'range', label: 'Default width', value: 160, min: 40, max: 420, step: 5, suffix: ' pt', hint: 'Used when you click rather than drag a box.' },
      { name: 'date', type: 'checkbox', label: 'Write the date beside it', value: false },
      { name: 'dateText', type: 'text', label: 'Date wording', value: '', placeholder: "today's date", when: (v) => v.date },
      { name: 'dateSize', type: 'range', label: 'Date size', value: 9, min: 5, max: 24, step: 0.5, suffix: ' pt', when: (v) => v.date },
      { name: 'dateColor', type: 'color', label: 'Date colour', value: '#404650', when: (v) => v.date },
      {
        name: 'everyPage', type: 'checkbox', label: 'Repeat on every page', value: false,
        hint: 'Places a copy at the same spot on all pages.',
      },
    ],

    onFieldChange(a) { values = a.values; },

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      if (!signature) return 'Make a signature first — draw, type or bring one in.';
      if (!stage?.items.length) return 'Drag on the page to place the signature.';
      return null;
    },

    async run(a) {
      const { degrees } = await pdflib();
      const file = a.files[0];
      const doc = await openDoc(file);
      const pages = doc.getPages();
      const image = await doc.embedPng(await signature.blob.arrayBuffer());
      const dateColour = await hexColor(a.values.dateColor);
      const font = a.values.date ? (await embedFont(doc, 'helvetica', { text: dateLabel(a.values) })).font : null;

      const placements = [];
      for (const item of stage.items) {
        if (a.values.everyPage) pages.forEach((_, i) => placements.push({ ...item, page: i }));
        else placements.push(item);
      }

      for (let i = 0; i < placements.length; i++) {
        const item = placements[i];
        await a.progress(i / placements.length, `Signing page ${item.page + 1}…`);
        const page = pages[item.page];
        if (!page) continue;
        const rotate = degrees(pageAngle(page));
        const p = toUser(page, item.x, item.y);
        page.drawImage(image, { x: p.x, y: p.y, width: item.w, height: item.h, rotate });

        if (font) {
          const text = dateLabel(a.values);
          const size = Number(a.values.dateSize);
          const dp = toUser(page, item.x, item.y - size * 1.4);
          page.drawText(text, { x: dp.x, y: dp.y, size, font, color: dateColour, rotate });
        }
      }

      await a.progress(0.92, 'Saving…');
      await a.done([{ name: `${stem(file.name)}-signed.pdf`, data: await saveDoc(doc), note: `${plural(placements.length, 'signature')} placed` }]);
    },
  });

  /* ---- Signature maker, in the job ticket ------------------------------ */
  wb.panelBody.prepend(buildMaker());
  wb.panelBody.append(gallery);

  function buildMaker() {
    const pad = h('canvas', {
      width: 600, height: 220,
      style: { width: '100%', height: '110px', background: 'var(--bg-3)', border: '1px dashed var(--line-2)', borderRadius: 'var(--r-sm)', cursor: 'crosshair', touchAction: 'none' },
    });
    const ctx = pad.getContext('2d');
    let drawing = false;
    let dirty = false;
    let last = null;

    const pos = (e) => {
      const box = pad.getBoundingClientRect();
      return { x: (e.clientX - box.left) * (pad.width / box.width), y: (e.clientY - box.top) * (pad.height / box.height) };
    };
    pad.addEventListener('pointerdown', (e) => {
      pad.setPointerCapture(e.pointerId);
      drawing = true; dirty = true; last = pos(e);
    });
    pad.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.strokeStyle = '#101418';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    const stop = () => { drawing = false; };
    pad.addEventListener('pointerup', stop);
    pad.addEventListener('pointerleave', stop);

    const typed = h('input', { type: 'text', placeholder: 'Type your name instead' });

    const useDrawn = async () => {
      if (!dirty) { wb.toast('Draw your signature in the box first.', 'error'); return; }
      const trimmed = trim(pad);
      await setSignature(await canvasToBlob(trimmed, 'image/png'), trimmed.width / trimmed.height, 'drawn');
    };

    const useTyped = async () => {
      const name = typed.value.trim();
      if (!name) { wb.toast('Type a name first.', 'error'); return; }
      const canvas = renderTyped(name);
      await setSignature(await canvasToBlob(canvas, 'image/png'), canvas.width / canvas.height, 'typed');
    };

    const useFile = async () => {
      const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp' });
      if (!file) return;
      const canvas = await imageToTransparent(file);
      await setSignature(await canvasToBlob(canvas, 'image/png'), canvas.width / canvas.height, file.name);
    };

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '.55rem' } }, [
      h('span.eyebrow', 'Your signature'),
      pad,
      h('div.grid-2', [
        h('button.btn.btn--sm', { type: 'button', onclick: useDrawn }, [icon('check', 13), 'Use drawing']),
        h('button.btn.btn--sm', { type: 'button', onclick: () => { ctx.clearRect(0, 0, pad.width, pad.height); dirty = false; } }, [icon('reset', 13), 'Clear pad']),
      ]),
      h('div.field', [h('span.field__label', 'Or type it'), typed]),
      h('div.grid-2', [
        h('button.btn.btn--sm', { type: 'button', onclick: useTyped }, 'Use typed name'),
        h('button.btn.btn--sm', { type: 'button', onclick: useFile }, 'Open an image'),
      ]),
    ]);
  }

  async function setSignature(blob, ratio, label) {
    if (signature?.url) URL.revokeObjectURL(signature.url);
    signature = { blob, url: URL.createObjectURL(blob), ratio, label };
    clear(gallery).append(
      h('div.eyebrow', { style: { marginTop: '.4rem' } }, 'Ready to place'),
      h('div', { style: { background: 'var(--bg-3)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-sm)', padding: '.5rem' } },
        h('img', { src: signature.url, alt: `Signature (${label})`, style: { maxHeight: '54px', margin: '0 auto' } })),
      h('p.field__hint', 'Now drag a box on the page where it belongs.'),
    );
    wb.renderStage();
  }

  function buildStage() {
    return canvasStage({
      minSize: 14,
      allowClick: true,
      newItem: (rect) => {
        if (!signature) { wb.toast('Make a signature first.', 'error'); return null; }
        // A quick click rather than a deliberate drag gets the default size.
        const width = rect.w < 30 ? Number(values.width) : rect.w;
        return { kind: 'sign', ...rect, w: width, h: width / signature.ratio };
      },
      draw: () => h('img', { src: signature?.url || '', alt: '', style: { width: '100%', height: '100%', objectFit: 'contain' } }),
      onResize: (item) => { if (signature) item.h = item.w / signature.ratio; },
    });
  }

  return wb;
}

const dateLabel = (v) => (String(v.dateText || '').trim() || new Date().toLocaleDateString());

/** Crop the transparent border off the pad so the placed image is tight. */
function trim(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas;
  const pad = 8;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function renderTyped(name) {
  const size = 120;
  const measure = document.createElement('canvas').getContext('2d');
  const face = `italic 600 ${size}px "Segoe Script", "Bradley Hand", "Snell Roundhand", "URW Chancery L", cursive, serif`;
  measure.font = face;
  const width = Math.ceil(measure.measureText(name).width) + 40;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(120, width);
  canvas.height = Math.round(size * 1.6);
  const ctx = canvas.getContext('2d');
  ctx.font = face;
  ctx.fillStyle = '#101418';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 20, canvas.height / 2);
  return canvas;
}

/** Knock the white paper out of a photographed signature. */
async function imageToTransparent(file) {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = img.width || img.naturalWidth;
  canvas.height = img.height || img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  img.close?.();
  try {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      if (lum > 205) d[i + 3] = 0;
      else if (lum > 150) d[i + 3] = Math.round(255 * (205 - lum) / 55);
    }
    ctx.putImageData(image, 0, 0);
  } catch { /* tainted canvas cannot happen for local files, but be safe */ }
  return trim(canvas);
}
