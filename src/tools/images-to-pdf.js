import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { saveDoc, PAGE_SIZES } from '../core/pdf.js';
import { loadImage, canvasToBlob } from '../core/files.js';
import { hexColor, mm } from '../core/geometry.js';
import { stem, plural } from '../ui/kit.js';

export default function mount(host, tool) {
  workbench(host, tool, {
    accept: 'image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.avif',
    multiple: true,
    action: 'Build the PDF',
    actionIcon: 'imagesToPdf',
    dropTitle: 'Choose images, or drop them here',
    dropHint: 'JPG, PNG, WebP, GIF, BMP and AVIF — one page per image',

    fields: [
      {
        name: 'size', type: 'select', label: 'Page size', value: 'auto',
        options: [
          { value: 'auto', label: 'Match each image' },
          ...Object.entries(PAGE_SIZES).map(([k, v]) => ({ value: k, label: v.label })),
        ],
      },
      {
        name: 'orientation', type: 'segmented', label: 'Orientation', value: 'auto',
        when: (v) => v.size !== 'auto',
        options: [{ value: 'auto', label: 'Per image' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }],
      },
      {
        name: 'fit', type: 'segmented', label: 'How the image sits', value: 'contain',
        when: (v) => v.size !== 'auto',
        options: [
          { value: 'contain', label: 'Fit', title: 'The whole image, letterboxed' },
          { value: 'cover', label: 'Fill', title: 'Fills the page, edges cropped' },
          { value: 'stretch', label: 'Stretch', title: 'Distorts to the page' },
        ],
      },
      { name: 'margin', type: 'range', label: 'Margin', value: 0, min: 0, max: 40, step: 1, suffix: ' mm', when: (v) => v.size !== 'auto' },
      { name: 'bg', type: 'color', label: 'Page colour', value: '#ffffff', when: (v) => v.size !== 'auto' },
      {
        name: 'quality', type: 'range', label: 'JPEG quality for converted images', value: 88, min: 40, max: 100, step: 1, suffix: '%',
        hint: 'PNGs with transparency are kept lossless. Everything else is re-encoded at this quality.',
      },
      { name: 'sort', type: 'checkbox', label: 'Sort by file name first', value: true, hint: 'Handles img2, img10 the way you would expect.' },
      { name: 'outName', type: 'text', label: 'Save as', value: 'images.pdf' },
    ],

    async run(a) {
      const { PDFDocument } = await pdflib();
      const v = a.values;
      const out = await PDFDocument.create();
      const files = v.sort ? [...a.files].sort(naturalBy((f) => f.name)) : [...a.files];
      const background = await hexColor(v.bg);
      const pad = mm(v.margin);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await a.progress(i / files.length, `${file.name} (${i + 1}/${files.length})…`);
        const { bytes, type, width, height } = await prepare(file, v.quality / 100);
        const image = type === 'png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);

        if (v.size === 'auto') {
          const page = out.addPage([width, height]);
          page.drawImage(image, { x: 0, y: 0, width, height });
          continue;
        }

        const base = PAGE_SIZES[v.size];
        const landscape = v.orientation === 'landscape' || (v.orientation === 'auto' && width > height);
        const pw = landscape ? base.h : base.w;
        const ph = landscape ? base.w : base.h;
        const page = out.addPage([pw, ph]);
        page.drawRectangle({ x: 0, y: 0, width: pw, height: ph, color: background });

        const boxW = Math.max(1, pw - pad * 2);
        const boxH = Math.max(1, ph - pad * 2);
        let w = boxW, hgt = boxH;
        if (v.fit !== 'stretch') {
          const scale = v.fit === 'cover'
            ? Math.max(boxW / width, boxH / height)
            : Math.min(boxW / width, boxH / height);
          w = width * scale;
          hgt = height * scale;
        }
        page.drawImage(image, { x: pad + (boxW - w) / 2, y: pad + (boxH - hgt) / 2, width: w, height: hgt });
      }

      out.setTitle(stem(v.outName || 'images'));
      out.setProducer('Quire');
      out.setCreator('Quire');
      await a.progress(0.95, 'Saving…');
      const name = (v.outName || 'images.pdf').replace(/(\.pdf)?$/i, '.pdf');
      await a.done([{ name, data: await saveDoc(out), note: plural(files.length, 'page') }]);
    },
  });
}

/**
 * PDF can carry JPEG and PNG directly; anything else (WebP, AVIF, GIF, BMP) is
 * decoded and re-encoded here. Transparency is kept by choosing PNG.
 */
async function prepare(file, quality) {
  const isJpeg = /jpe?g$/i.test(file.type) || /\.jpe?g$/i.test(file.name);
  const isPng = /png$/i.test(file.type) || /\.png$/i.test(file.name);

  if (isJpeg || isPng) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const size = await measure(file);
    // A CMYK or progressive JPEG that pdf-lib cannot parse falls through to canvas.
    try {
      if (isJpeg) { checkJpeg(buf); return { bytes: buf, type: 'jpg', ...size }; }
      return { bytes: buf, type: 'png', ...size };
    } catch { /* re-encode below */ }
  }

  const img = await loadImage(file);
  const width = img.width || img.naturalWidth;
  const height = img.height || img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const transparent = hasAlpha(ctx, width, height);
  const blob = await canvasToBlob(canvas, transparent ? 'image/png' : 'image/jpeg', quality);
  img.close?.();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: transparent ? 'png' : 'jpg', width, height };
}

async function measure(file) {
  const img = await loadImage(file);
  const size = { width: img.width || img.naturalWidth, height: img.height || img.naturalHeight };
  img.close?.();
  return size;
}

function checkJpeg(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a jpeg');
}

/** Sample the alpha channel — a fully opaque image is smaller as JPEG. */
function hasAlpha(ctx, w, h) {
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] < 250) return true;
      }
    }
  } catch { return true; }
  return false;
}

/** "page2" before "page10". */
function naturalBy(get) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return (a, b) => collator.compare(get(a), get(b));
}
