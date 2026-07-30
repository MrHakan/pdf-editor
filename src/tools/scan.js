import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { saveDoc, PAGE_SIZES } from '../core/pdf.js';
import { canvasToBlob } from '../core/files.js';
import { mm } from '../core/geometry.js';
import { h, clear, icon, plural } from '../ui/kit.js';

/**
 * Use the device camera as a document scanner.
 *
 * The video stream never leaves the page — frames are grabbed to a canvas,
 * cleaned up, and bound into a PDF. Nothing is recorded and nothing is sent.
 */
export default function mount(host, tool) {
  let stream = null;
  let video = null;
  let shots = [];       // { canvas, url }
  let shelf = null;

  const wb = workbench(host, tool, {
    accept: 'image/*',
    multiple: true,
    noFiles: true,
    action: 'Bind the pages',
    actionIcon: 'scan',
    plainStage: true,

    stage(a, stageEl) {
      video = h('video', { autoplay: true, playsinline: true, muted: true, style: { width: '100%', maxHeight: '46dvh', objectFit: 'contain', background: '#000', borderRadius: 'var(--r-sm)' } });
      shelf = h('div', { style: { display: 'flex', gap: '.5rem', flexWrap: 'wrap' } });

      const startBtn = h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => start(a) }, [icon('scan', 14), 'Turn the camera on']);
      const shootBtn = h('button.btn.btn--sm', { type: 'button', disabled: true, onclick: () => capture(a) }, [icon('plus', 14), 'Capture page']);
      const stopBtn = h('button.btn.btn--sm', { type: 'button', disabled: true, onclick: () => stop() }, 'Turn off');

      stageEl.append(
        h('div.stage__toolbar', [startBtn, shootBtn, stopBtn, h('span.spacer'), h('span.stage__hint#scan-count', shots.length ? plural(shots.length, 'page captured', 'pages captured') : 'Nothing captured yet')]),
        video,
        h('p.stage__hint', 'Fill the frame with the page, hold steady, and capture. Frames are processed in this tab and are never recorded.'),
        shelf,
      );
      drawShelf(a);

      async function start() {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
            audio: false,
          });
          video.srcObject = stream;
          startBtn.disabled = true;
          shootBtn.disabled = false;
          stopBtn.disabled = false;
        } catch (err) {
          a.toast(err.name === 'NotAllowedError' ? 'Camera access was refused. Allow it in the address bar and try again.' : 'No camera is available on this device.', 'error');
        }
      }

      function stop() {
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
        video.srcObject = null;
        startBtn.disabled = false;
        shootBtn.disabled = true;
        stopBtn.disabled = true;
      }

      host.addEventListener('quire:teardown', stop, { once: true });
    },

    fields: [
      {
        name: 'treatment', type: 'segmented', label: 'Clean-up', value: 'paper',
        options: [
          { value: 'none', label: 'None', title: 'Keep the photo as it is' },
          { value: 'gray', label: 'Gray', title: 'Grayscale only' },
          { value: 'paper', label: 'Paper', title: 'Grayscale with the page whitened' },
          { value: 'ink', label: 'High contrast', title: 'Nearly black and white, for text' },
        ],
      },
      { name: 'contrast', type: 'range', label: 'Strength', value: 55, min: 0, max: 100, step: 5, suffix: '%', when: (v) => v.treatment !== 'none' },
      { name: 'size', type: 'select', label: 'Page size', value: 'a4', options: [{ value: 'auto', label: 'Match the photo' }, ...Object.entries(PAGE_SIZES).map(([k, s]) => ({ value: k, label: s.label }))] },
      { name: 'margin', type: 'range', label: 'Margin', value: 0, min: 0, max: 25, step: 1, suffix: ' mm', when: (v) => v.size !== 'auto' },
      { name: 'quality', type: 'range', label: 'JPEG quality', value: 82, min: 40, max: 100, step: 1, suffix: '%' },
      { name: 'outName', type: 'text', label: 'Save as', value: 'scan.pdf' },
    ],

    onFieldChange(a) { drawShelf(a); },

    validate() { return shots.length ? null : 'Capture at least one page first.'; },

    async run(a) {
      const { PDFDocument } = await pdflib();
      const v = a.values;
      const doc = await PDFDocument.create();
      const pad = mm(v.margin);

      for (let i = 0; i < shots.length; i++) {
        await a.progress(i / shots.length, `Page ${i + 1} of ${shots.length}…`);
        const processed = process(shots[i].canvas, v);
        const blob = await canvasToBlob(processed, 'image/jpeg', v.quality / 100);
        const image = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));

        if (v.size === 'auto') {
          const page = doc.addPage([image.width, image.height]);
          page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        } else {
          const base = PAGE_SIZES[v.size];
          const landscape = image.width > image.height;
          const pw = landscape ? base.h : base.w;
          const ph = landscape ? base.w : base.h;
          const page = doc.addPage([pw, ph]);
          const boxW = pw - pad * 2;
          const boxH = ph - pad * 2;
          const scale = Math.min(boxW / image.width, boxH / image.height);
          const w = image.width * scale;
          const hgt = image.height * scale;
          page.drawImage(image, { x: pad + (boxW - w) / 2, y: pad + (boxH - hgt) / 2, width: w, height: hgt });
        }
        processed.width = processed.height = 0;
      }

      doc.setProducer('Quire');
      doc.setCreator('Quire');
      await a.progress(0.94, 'Saving…');
      const name = (v.outName || 'scan.pdf').replace(/(\.pdf)?$/i, '.pdf');
      await a.done([{ name, data: await saveDoc(doc), note: plural(shots.length, 'page') }]);
    },
  });

  function capture(a) {
    if (!video?.videoWidth) { a.toast('The camera has not started yet.', 'error'); return; }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    shots.push({ canvas, url: canvas.toDataURL('image/jpeg', 0.6) });
    drawShelf(a);
    a.enableRun(true);
  }

  function drawShelf(a) {
    if (!shelf) return;
    clear(shelf);
    const counter = document.getElementById('scan-count');
    if (counter) counter.textContent = shots.length ? `${plural(shots.length, 'page')} captured` : 'Nothing captured yet';
    shots.forEach((shot, i) => {
      shelf.append(h('div', { style: { position: 'relative' } }, [
        h('img', { src: shot.url, alt: `Page ${i + 1}`, style: { width: '78px', height: '104px', objectFit: 'cover', border: '1px solid var(--line-2)', borderRadius: '2px' } }),
        h('button.btn.btn--sm.btn--icon', {
          type: 'button', title: 'Discard', style: { position: 'absolute', top: '-8px', right: '-8px', width: '22px', height: '22px', padding: '0' },
          onclick: () => { shots.splice(i, 1); drawShelf(a); a.enableRun(shots.length > 0); },
        }, icon('x', 12)),
        h('span', { style: { position: 'absolute', bottom: '2px', left: '2px', font: '600 9px var(--mono)', background: 'rgba(0,0,0,.6)', color: '#fff', padding: '1px 3px', borderRadius: '2px' } }, String(i + 1)),
      ]));
    });
  }

  return wb;
}

/** Flatten the lighting so a photographed page reads as a scan. */
function process(source, v) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  if (v.treatment === 'none') return canvas;

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  const strength = Number(v.contrast) / 100;

  // Find the paper white by sampling the brightest decile.
  let peak = 0;
  for (let i = 0; i < d.length; i += 4 * 37) {
    const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    if (lum > peak) peak = lum;
  }
  const white = Math.max(80, peak * 0.94);

  for (let i = 0; i < d.length; i += 4) {
    let lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    if (v.treatment !== 'gray') {
      lum = Math.min(255, (lum / white) * 255);
      const mid = v.treatment === 'ink' ? 205 : 235;
      const gain = 1 + strength * (v.treatment === 'ink' ? 3.2 : 1.4);
      lum = Math.max(0, Math.min(255, (lum - mid) * gain + mid));
    }
    d[i] = d[i + 1] = d[i + 2] = lum;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
