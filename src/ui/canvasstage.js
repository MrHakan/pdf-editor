import { h, clear, icon } from './kit.js';
import { openViewer, renderPage } from '../core/pdf.js';

/**
 * A page you can put things on.
 *
 * Renders one page at a time and floats an overlay above it. Items are stored
 * in visual PDF points with the origin at the bottom-left, which is what the
 * drawing helpers expect, so what the overlay shows and what pdf-lib writes
 * cannot drift apart.
 */
export function canvasStage(opts = {}) {
  const {
    onChange = () => {},
    onSelect = () => {},
    onPage = () => {},
    draw = null,          // (item) => Element, custom item rendering
    minSize = 8,
  } = opts;
  // Read at call time so a tool can switch between box mode and pen mode.
  const newItem = (...args) => opts.newItem?.(...args);
  const penActive = () => Boolean(opts.pen?.());

  let viewer = null;
  let pageIndex = 0;
  let scale = 1;
  let pageSize = { width: 612, height: 792 };
  let items = [];
  let selectedId = null;
  let renderToken = 0;

  const canvasHolder = h('div.sheet-holder');
  const overlay = h('div.overlay-layer');
  canvasHolder.append(overlay);
  const wrap = h('div.canvas-wrap', canvasHolder);

  const pageNo = h('span.pager__no', '—');
  const prev = h('button.btn.btn--sm.btn--icon', { type: 'button', title: 'Previous page', onclick: () => goto(pageIndex - 1) }, icon('chevL', 14));
  const next = h('button.btn.btn--sm.btn--icon', { type: 'button', title: 'Next page', onclick: () => goto(pageIndex + 1) }, icon('chevR', 14));
  const pager = h('div.pager', [prev, pageNo, next]);

  /* ---- Coordinates ---------------------------------------------------- */
  const toScreen = (x, y) => ({ left: x * scale, top: (pageSize.height - y) * scale });
  const toPage = (clientX, clientY) => {
    const box = canvasHolder.getBoundingClientRect();
    return {
      x: (clientX - box.left) / scale,
      y: pageSize.height - (clientY - box.top) / scale,
    };
  };

  /* ---- Rendering ------------------------------------------------------ */
  async function setFile(file) {
    viewer?.destroy();
    viewer = file ? await openViewer(file) : null;
    pageIndex = 0;
    items = [];
    await render();
  }

  async function goto(n) {
    if (!viewer) return;
    const next = Math.max(0, Math.min(viewer.numPages - 1, n));
    if (next === pageIndex) return;
    pageIndex = next;
    await render();
    onPage(pageIndex);
  }

  async function render() {
    if (!viewer) { clear(canvasHolder).append(overlay); return; }
    const mine = ++renderToken;
    const page = await viewer.getPage(pageIndex + 1);
    const vp = page.getViewport({ scale: 1 });
    const box = wrap.getBoundingClientRect();
    const fit = Math.min((box.width - 36) / vp.width, (box.height - 36) / vp.height) || 0.8;
    scale = Math.max(0.12, Math.min(fit, 3));
    pageSize = { width: vp.width, height: vp.height };

    const canvas = await renderPage(page, scale);
    if (mine !== renderToken) return;
    page.cleanup();

    clear(canvasHolder);
    canvasHolder.style.width = `${canvas.width}px`;
    canvasHolder.style.height = `${canvas.height}px`;
    canvasHolder.append(canvas, overlay);
    pageNo.textContent = `${pageIndex + 1} / ${viewer.numPages}`;
    prev.disabled = pageIndex === 0;
    next.disabled = pageIndex >= viewer.numPages - 1;
    paint();
  }

  /* ---- Overlay -------------------------------------------------------- */
  function paint() {
    clear(overlay);
    for (const item of items) {
      if (item.page !== pageIndex) continue;
      const { left, top } = toScreen(item.x, item.y + item.h);
      const el = h('div', {
        dataset: { id: item.id },
        style: {
          position: 'absolute',
          left: `${left}px`, top: `${top}px`,
          width: `${item.w * scale}px`, height: `${item.h * scale}px`,
          cursor: 'move', boxSizing: 'border-box',
          outline: item.id === selectedId ? '1.5px solid var(--accent)' : '1px dashed rgba(120,140,170,.55)',
          outlineOffset: '0',
        },
      });
      const body = draw?.(item, scale);
      if (body) el.append(body);
      el.addEventListener('pointerdown', (e) => startDrag(e, item, el));
      if (item.id === selectedId) el.append(resizeHandle(item, el), removeButton(item));
      overlay.append(el);
    }
    onChange(api);
  }

  function resizeHandle(item, el) {
    const grip = h('span', {
      style: {
        position: 'absolute', right: '-6px', bottom: '-6px', width: '12px', height: '12px',
        background: 'var(--accent)', border: '2px solid var(--bg)', borderRadius: '2px', cursor: 'nwse-resize',
      },
    });
    grip.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const start = toPage(e.clientX, e.clientY);
      const origin = { ...item };
      const move = (ev) => {
        const p = toPage(ev.clientX, ev.clientY);
        item.w = Math.max(minSize, origin.w + (p.x - start.x));
        item.h = Math.max(minSize, origin.h - (p.y - start.y));
        item.y = origin.y + (p.y - start.y);
        el.style.width = `${item.w * scale}px`;
        el.style.height = `${item.h * scale}px`;
        el.style.top = `${toScreen(item.x, item.y + item.h).top}px`;
        opts.onResize?.(item);
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); paint(); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    return grip;
  }

  function removeButton(item) {
    const b = h('button', {
      type: 'button', title: 'Remove', 'aria-label': 'Remove',
      style: {
        position: 'absolute', right: '-10px', top: '-10px', width: '20px', height: '20px',
        display: 'grid', placeItems: 'center', borderRadius: '50%', cursor: 'pointer',
        background: 'var(--danger)', color: '#fff', border: '2px solid var(--bg)', padding: '0',
      },
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => { e.stopPropagation(); remove(item.id); },
    }, icon('x', 10, { width: 3 }));
    return b;
  }

  function startDrag(e, item, el) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    select(item.id);
    const start = toPage(e.clientX, e.clientY);
    const origin = { x: item.x, y: item.y };
    let moved = false;
    const move = (ev) => {
      const p = toPage(ev.clientX, ev.clientY);
      item.x = origin.x + (p.x - start.x);
      item.y = origin.y + (p.y - start.y);
      moved = true;
      const pos = toScreen(item.x, item.y + item.h);
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
      opts.onMove?.(item);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) onChange(api);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---- Drawing a new box ---------------------------------------------- */
  let ghost = null;
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target !== overlay) return;
    select(null);
    if (penActive()) { captureStroke(e); return; }
    if (!opts.newItem) return;
    e.preventDefault();
    const start = toPage(e.clientX, e.clientY);
    ghost = h('div', { style: { position: 'absolute', border: '1.5px solid var(--accent)', background: 'color-mix(in srgb, var(--accent) 18%, transparent)', pointerEvents: 'none' } });
    overlay.append(ghost);

    const move = (ev) => {
      const p = toPage(ev.clientX, ev.clientY);
      const rect = normalize(start, p);
      const pos = toScreen(rect.x, rect.y + rect.h);
      Object.assign(ghost.style, { left: `${pos.left}px`, top: `${pos.top}px`, width: `${rect.w * scale}px`, height: `${rect.h * scale}px` });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      ghost?.remove();
      ghost = null;
      const p = toPage(ev.clientX, ev.clientY);
      const rect = normalize(start, p);
      if (rect.w < 2 && rect.h < 2 && !opts.allowClick) { paint(); return; }
      const created = newItem({ ...rect, page: pageIndex });
      if (created) add(created);
      else paint();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  /** Freehand: collect a stroke, hand back the points in page coordinates. */
  function captureStroke(e) {
    e.preventDefault();
    const points = [toPage(e.clientX, e.clientY)];
    const trail = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    Object.assign(trail.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'visible' });
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', opts.penColor?.() || '#e0457b');
    path.setAttribute('stroke-width', String((opts.penWidth?.() || 2) * scale));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    trail.append(path);
    overlay.append(trail);

    const redraw = () => {
      path.setAttribute('d', points.map((p, i) => {
        const s = toScreen(p.x, p.y);
        return `${i ? 'L' : 'M'}${s.left.toFixed(1)},${s.top.toFixed(1)}`;
      }).join(' '));
    };
    redraw();

    const move = (ev) => {
      const p = toPage(ev.clientX, ev.clientY);
      const last = points[points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) * scale < 1.5) return;
      points.push(p);
      redraw();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      trail.remove();
      if (points.length > 1) opts.onStroke?.(points, pageIndex);
      else paint();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const normalize = (a, b) => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
  });

  /* ---- Items ---------------------------------------------------------- */
  let nextId = 1;
  function add(item) {
    const full = { id: `i${nextId++}`, page: pageIndex, x: 40, y: 40, w: 120, h: 40, ...item };
    items.push(full);
    selectedId = full.id;
    paint();
    onSelect(full);
    return full;
  }
  function remove(id) {
    items = items.filter((it) => it.id !== id);
    if (selectedId === id) selectedId = null;
    paint();
    onSelect(null);
  }
  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    paint();
    onSelect(items.find((it) => it.id === id) || null);
  }

  const api = {
    el: wrap,
    pager,
    setFile,
    goto,
    render,
    paint,
    add,
    remove,
    select,
    get items() { return items; },
    set items(v) { items = v; paint(); },
    get selected() { return items.find((it) => it.id === selectedId) || null; },
    get pageIndex() { return pageIndex; },
    get pageCount() { return viewer?.numPages || 0; },
    get pageSize() { return { ...pageSize }; },
    get scale() { return scale; },
    get viewer() { return viewer; },
    clearPage() { items = items.filter((it) => it.page !== pageIndex); paint(); },
    clearAll() { items = []; paint(); },
    destroy() { viewer?.destroy(); viewer = null; },
  };
  return api;
}
