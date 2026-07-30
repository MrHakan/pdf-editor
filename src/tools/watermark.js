import { workbench } from '../ui/workbench.js';
import { livePreview } from '../ui/preview.js';
import { pdflib } from '../core/lib.js';
import { openDoc, saveDoc, copyMetadata } from '../core/pdf.js';
import { embedFont, fontOptions } from '../core/fonts.js';
import { visualSize, toUser, pageAngle, hexColor, anchorPoint } from '../core/geometry.js';
import { parseRange, checkRange } from '../core/range.js';
import { loadImage, canvasToBlob } from '../core/files.js';
import { stem, plural } from '../ui/kit.js';

export default function mount(host, tool) {
  let total = 0;
  let stampFile = null;
  let preview = null;

  const wb = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Apply the watermark',
    actionIcon: 'watermark',
    dropTitle: 'Choose the PDF to stamp, or drop it here',

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
          label: 'Proof — drawn by the same code that writes the file',
          build: async (one) => applyWatermark(one, a.values, [0]),
        });
      }
      stageEl.append(preview.el);
      if (a.files[0] && preview.pageCount === 0) preview.setFile(a.files[0]);
    },

    onFieldChange(a, name) {
      if (name === 'stampFile') {
        stampFile = a.values.stampFile;
        if (stampFile) a.toast(`Using ${stampFile.name} as the stamp.`);
      }
      preview?.refresh();
    },

    fields: [
      {
        name: 'kind', type: 'segmented', label: 'Stamp', value: 'text',
        options: [{ value: 'text', label: 'Text' }, { value: 'image', label: 'Image' }],
      },
      { name: 'text', type: 'text', label: 'Wording', value: 'DRAFT', when: (v) => v.kind === 'text', placeholder: 'CONFIDENTIAL' },
      { name: 'font', type: 'select', label: 'Typeface', value: 'helvetica', options: fontOptions, when: (v) => v.kind === 'text' },
      { name: 'bold', type: 'checkbox', label: 'Bold', value: true, when: (v) => v.kind === 'text' },
      { name: 'fontSize', type: 'range', label: 'Size', value: 64, min: 8, max: 220, step: 2, suffix: ' pt', when: (v) => v.kind === 'text' },
      { name: 'color', type: 'color', label: 'Colour', value: '#e0457b', when: (v) => v.kind === 'text' },
      { name: 'outline', type: 'checkbox', label: 'Outline only', value: false, when: (v) => v.kind === 'text', hint: 'Leaves the text underneath readable.' },

      { name: 'stampFile', type: 'files', label: 'Stamp image', accept: 'image/*', when: (v) => v.kind === 'image', hint: 'PNG with transparency works best.' },
      { name: 'imageScale', type: 'range', label: 'Image width', value: 40, min: 5, max: 100, step: 1, suffix: '% of page', when: (v) => v.kind === 'image' },

      { name: 'opacity', type: 'range', label: 'Opacity', value: 22, min: 3, max: 100, step: 1, suffix: '%' },
      { name: 'angle', type: 'range', label: 'Angle', value: 45, min: -90, max: 90, step: 5, suffix: '°' },
      {
        name: 'placement', type: 'segmented', label: 'Placement', value: 'center',
        options: [{ value: 'center', label: 'Once' }, { value: 'tile', label: 'Tiled' }, { value: 'anchor', label: 'Corner' }],
      },
      { name: 'anchor', type: 'anchor', label: 'Corner', value: 'bottom-right', when: (v) => v.placement === 'anchor' },
      { name: 'inset', type: 'range', label: 'Distance from the edge', value: 18, min: 0, max: 90, step: 2, suffix: ' pt', when: (v) => v.placement === 'anchor' },
      { name: 'density', type: 'range', label: 'Tile spacing', value: 100, min: 40, max: 260, step: 5, suffix: '%', when: (v) => v.placement === 'tile' },
      {
        name: 'behind', type: 'checkbox', label: 'Draw behind the content', value: false,
        hint: 'Keeps text on top of the stamp. The document is rebuilt to do it, which flattens links and form fields.',
      },
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
      const v = a.values;
      if (v.kind === 'text' && !String(v.text).trim()) return 'Write the wording for the stamp.';
      if (v.kind === 'image' && !v.stampFile) return 'Choose an image to stamp with.';
      const res = checkRange(v.pages, total || 1);
      return res.ok ? null : res.error;
    },

    async run(a) {
      const file = a.files[0];
      const src = await openDoc(file);
      const indices = parseRange(a.values.pages, src.getPageCount());
      if (!indices.length) throw new Error('That range selects no pages.');

      await a.progress(0.25, `Stamping ${plural(indices.length, 'page')}…`);
      const doc = await applyWatermark(src, a.values, indices, { onProgress: (f) => a.progress(0.25 + f * 0.6) });

      copyMetadata(src, doc);
      await a.progress(0.92, 'Saving…');
      await a.done([{ name: `${stem(file.name)}-watermarked.pdf`, data: await saveDoc(doc), note: `${plural(indices.length, 'page')} stamped` }]);
    },
  });

  return wb;
}

/**
 * Stamp the document and return the one to save.
 *
 * Drawing on top is an in-place edit. Drawing underneath is not possible
 * without rewriting the page's content stream, so that path rebuilds the
 * document: mark first, original page on top of it.
 */
async function applyWatermark(doc, v, indices, opts = {}) {
  if (!v.behind) { await stamp(doc, v, indices, opts); return doc; }

  const { PDFDocument } = await pdflib();
  const out = await PDFDocument.create();
  const sourcePages = doc.getPages();
  const embedded = await out.embedPages(sourcePages);

  sourcePages.forEach((page, i) => {
    const { width, height } = page.getSize();
    const fresh = out.addPage([width, height]);
    fresh.setRotation(page.getRotation());
    fresh.__stampTarget = indices.includes(i);
  });

  await stamp(out, v, out.getPages().map((p, i) => i).filter((i) => out.getPage(i).__stampTarget), opts);

  out.getPages().forEach((page, i) => {
    const { width, height } = page.getSize();
    page.drawPage(embedded[i], { x: 0, y: 0, width, height });
  });
  return out;
}

/** Draw the watermark onto the given page indices of a pdf-lib document. */
async function stamp(doc, v, indices, { onProgress } = {}) {
  const { degrees, rgb } = await pdflib();
  const opacity = Math.max(0.02, Number(v.opacity) / 100);
  const colour = await hexColor(v.color);

  let font = null;
  let image = null;

  if (v.kind === 'text') {
    const res = await embedFont(doc, v.font, { bold: v.bold, text: v.text });
    font = res.font;
  } else if (v.stampFile) {
    image = await embedStamp(doc, v.stampFile);
  }
  if (v.kind === 'image' && !image) return;

  const pages = doc.getPages();
  for (let k = 0; k < indices.length; k++) {
    const page = pages[indices[k]];
    if (!page) continue;
    onProgress?.(k / indices.length);

    const { width: vw, height: vh } = visualSize(page);
    const angleOnScreen = Number(v.angle);
    const rotation = degrees(pageAngle(page) + angleOnScreen);

    // Size of the mark, measured in visual space.
    let markW, markH;
    if (v.kind === 'text') {
      markW = font.widthOfTextAtSize(v.text, Number(v.fontSize));
      markH = font.heightAtSize(Number(v.fontSize)) * 0.72;
    } else {
      markW = vw * (Number(v.imageScale) / 100);
      markH = markW * (image.height / image.width);
    }

    const draw = (cx, cy) => {
      // cx, cy is the centre of the mark in visual space.
      const rad = (angleOnScreen * Math.PI) / 180;
      const dx = -(markW / 2) * Math.cos(rad) + (markH / 2) * Math.sin(rad);
      const dy = -(markW / 2) * Math.sin(rad) - (markH / 2) * Math.cos(rad);
      const anchorVisual = { x: cx + dx, y: cy + dy };
      const p = toUser(page, anchorVisual.x, anchorVisual.y);

      if (v.kind === 'text') {
        const common = { size: Number(v.fontSize), font, rotate: rotation, opacity };
        if (v.outline) {
          // pdf-lib cannot stroke text, so the outline is drawn as four offset
          // copies with a white one knocking out the middle.
          const off = Math.max(0.7, Number(v.fontSize) / 70);
          for (const [ox, oy] of [[off, 0], [-off, 0], [0, off], [0, -off]]) {
            page.drawText(v.text, { ...common, x: p.x + ox, y: p.y + oy, color: colour });
          }
          page.drawText(v.text, { ...common, x: p.x, y: p.y, color: rgb(1, 1, 1) });
        } else {
          page.drawText(v.text, { ...common, x: p.x, y: p.y, color: colour });
        }
      } else {
        page.drawImage(image, { x: p.x, y: p.y, width: markW, height: markH, rotate: rotation, opacity });
      }
    };

    if (v.placement === 'tile') {
      const spacing = Number(v.density) / 100;
      const stepX = Math.max(40, markW * 1.35 * spacing);
      const stepY = Math.max(30, markH * 2.8 * spacing);
      for (let y = stepY * 0.35; y < vh + stepY; y += stepY) {
        for (let x = stepX * 0.3; x < vw + stepX; x += stepX) draw(x, y);
      }
    } else if (v.placement === 'anchor') {
      const inset = Number(v.inset);
      const pos = anchorPoint(v.anchor, { x: inset, y: inset, width: vw - inset * 2, height: vh - inset * 2 }, markW, markH);
      draw(pos.x + markW / 2, pos.y + markH / 2);
    } else {
      draw(vw / 2, vh / 2);
    }
  }
}

async function embedStamp(doc, file) {
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
