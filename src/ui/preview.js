import { h, clear, icon, debounce } from './kit.js';
import { openDoc, openViewer, saveDoc, renderPage, extractPages } from '../core/pdf.js';
import { pdfjs, pdfjsAssets } from '../core/lib.js';

/**
 * A live proof.
 *
 * Rather than approximate the result in HTML, this runs the tool's own drawing
 * code over a one-page copy of the document and renders that. What you see is
 * produced by the same path as the file you will save.
 */
export function livePreview({ build, label = 'Proof' }) {
  let file = null;
  let viewer = null;
  let pageIndex = 0;
  let pageCount = 0;
  let token = 0;

  const holder = h('div.sheet-holder');
  const wrap = h('div.canvas-wrap', holder);
  const pageNo = h('span.pager__no', '—');
  const status = h('span.stage__hint');

  const prev = h('button.btn.btn--sm.btn--icon', { type: 'button', title: 'Previous page', onclick: () => go(-1) }, icon('chevL', 14));
  const next = h('button.btn.btn--sm.btn--icon', { type: 'button', title: 'Next page', onclick: () => go(1) }, icon('chevR', 14));

  const bar = h('div.stage__toolbar', [
    h('span.eyebrow', label),
    h('span.spacer'),
    status,
    h('div.pager', [prev, pageNo, next]),
  ]);

  const el = h('div', { style: { display: 'contents' } });
  el.append(bar, wrap);

  function go(delta) {
    pageIndex = Math.max(0, Math.min(pageCount - 1, pageIndex + delta));
    render();
  }

  async function setFile(f) {
    file = f;
    viewer?.destroy();
    viewer = null;
    pageIndex = 0;
    pageCount = 0;
    if (!f) { clear(holder); return; }
    viewer = await openViewer(f);
    pageCount = viewer.numPages;
    await render();
  }

  const render = async () => {
    if (!file || !viewer) return;
    const mine = ++token;
    pageNo.textContent = `${pageIndex + 1} / ${pageCount}`;
    prev.disabled = pageIndex === 0;
    next.disabled = pageIndex >= pageCount - 1;
    status.textContent = 'drawing…';

    try {
      let source = viewer;
      let sourcePage = pageIndex;

      if (build) {
        const src = await openDoc(file);
        const one = await extractPages(src, [pageIndex]);
        await build(one, { pageIndex, sourceDoc: src });
        const bytes = await saveDoc(one);
        if (mine !== token) return;
        const lib = await pdfjs();
        source = await lib.getDocument({ data: bytes.slice(), ...pdfjsAssets, isEvalSupported: false }).promise;
        sourcePage = 0;
      }

      const page = await source.getPage(sourcePage + 1);
      const box = wrap.getBoundingClientRect();
      const vp = page.getViewport({ scale: 1 });
      const scale = Math.min((box.width - 34) / vp.width, (box.height - 34) / vp.height, 2.4) || 0.6;
      const canvas = await renderPage(page, Math.max(0.15, scale));
      if (mine !== token) return;
      clear(holder).append(canvas);
      page.cleanup();
      if (source !== viewer) source.destroy();
      status.textContent = '';
    } catch (err) {
      if (mine !== token) return;
      status.textContent = 'could not draw this page';
      console.error(err);
    }
  };

  return {
    el,
    setFile,
    refresh: debounce(render, 220),
    renderNow: render,
    get pageIndex() { return pageIndex; },
    get pageCount() { return pageCount; },
    destroy() { viewer?.destroy(); viewer = null; },
  };
}
