import { h, clear, icon } from './kit.js';
import { renderPage, fitScale } from '../core/pdf.js';

/**
 * The page grid: a stack of sheets you can pick, reorder, turn and cut.
 *
 * Thumbnails render only when they scroll into view and are cached per source
 * page, so a 500 page document stays responsive.
 */
export function pageGrid(opts) {
  const {
    viewer,                // PDF.js document
    count = viewer?.numPages || 0,
    mode = 'organize',     // 'organize' | 'select' | 'view'
    thumbPx = 220,
    onChange = () => {},
    onOpen = null,
    badge = null,          // (item, i) => string
  } = opts;

  let items = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, src: i, rotate: 0, cut: false }));
  const selected = new Set();
  const cache = new Map();
  const el = h('div.pages', { role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Pages' });
  let lastClicked = null;

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      paint(entry.target);
    }
  }, { root: el, rootMargin: '400px 0px' });

  async function paint(sheet) {
    const src = Number(sheet.dataset.src);
    try {
      if (!cache.has(src)) {
        cache.set(src, (async () => {
          const page = await viewer.getPage(src + 1);
          const canvas = await renderPage(page, fitScale(page, thumbPx));
          page.cleanup();
          return canvas.toDataURL('image/jpeg', 0.7);
        })());
      }
      const url = await cache.get(src);
      if (!sheet.isConnected) return;
      const img = h('img', { src: url, alt: `Page ${src + 1}`, loading: 'lazy' });
      applyRotation(img, Number(sheet.dataset.rotate) || 0);
      clear(sheet).append(img);
    } catch {
      clear(sheet).append(h('span.pg__no', 'unreadable'));
    }
  }

  function applyRotation(img, deg) {
    const turned = deg % 180 !== 0;
    img.style.transform = `rotate(${deg}deg)${turned ? ' scale(.76)' : ''}`;
  }

  function render() {
    clear(el);
    items.forEach((item, i) => {
      const sheet = h('div.pg__sheet', { dataset: { src: item.src, rotate: item.rotate } }, h('span.pg__no', '…'));
      const tools = mode === 'organize' ? h('div.pg__tools', [
        tool('rotate', 'Turn left', (e) => { e.stopPropagation(); turn(i, -90); }),
        tool('rotate', 'Turn right', (e) => { e.stopPropagation(); turn(i, 90); }, true),
        tool('copy', 'Duplicate', (e) => { e.stopPropagation(); duplicate(i); }),
        tool('trash', item.cut ? 'Keep page' : 'Remove page', (e) => { e.stopPropagation(); cut(i); }, false, 'pg__tool--cut'),
      ]) : null;

      const cell = h(`button.pg${item.cut ? '.is-cut' : ''}`, {
        type: 'button',
        role: 'option',
        'aria-selected': String(selected.has(item.id)),
        draggable: mode === 'organize',
        dataset: { i },
        onclick: (e) => click(i, e),
        ondblclick: () => onOpen?.(item, i),
      }, [
        h('div.pg__sheet_wrap', { style: { width: '100%', position: 'relative' } }, [sheet, tools].filter(Boolean)),
        h('span.pg__no', `${i + 1}${item.src !== i || item.rotate ? ` · p${item.src + 1}` : ''}`),
      ]);

      // The wrapper above is only for positioning; keep the sheet as the visual.
      const badgeText = badge?.(item, i);
      if (badgeText) sheet.append(h('span.pg__badge', badgeText));

      if (mode === 'organize') attachDrag(cell, i);
      el.append(cell);
      observer.observe(sheet);
    });
    onChange(api);
  }

  function tool(name, title, onclick, flip = false, extra = '') {
    const b = h(`span.pg__tool${extra ? '.' + extra : ''}`, { role: 'button', tabindex: '0', title, 'aria-label': title, onclick, onkeydown: (e) => { if (e.key === 'Enter') onclick(e); } }, icon(name, 13));
    if (flip) b.firstChild.style.transform = 'scaleX(-1)';
    return b;
  }

  let dragFrom = null;
  function attachDrag(cell, i) {
    cell.addEventListener('dragstart', (e) => { dragFrom = i; cell.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
    cell.addEventListener('dragend', () => { cell.classList.remove('is-dragging'); dragFrom = null; });
    cell.addEventListener('dragover', (e) => { if (dragFrom === null) return; e.preventDefault(); cell.classList.add('is-target'); });
    cell.addEventListener('dragleave', () => cell.classList.remove('is-target'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault(); cell.classList.remove('is-target');
      if (dragFrom === null || dragFrom === i) return;
      const moving = selected.size > 1 && selected.has(items[dragFrom].id)
        ? items.filter((it) => selected.has(it.id))
        : [items[dragFrom]];
      const target = items[i];
      items = items.filter((it) => !moving.includes(it));
      const at = items.indexOf(target);
      items.splice(at < 0 ? items.length : at + (dragFrom < i ? 1 : 0), 0, ...moving);
      dragFrom = null;
      render();
    });
  }

  function click(i, e) {
    const id = items[i].id;
    if (e.shiftKey && lastClicked !== null) {
      const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
      for (let k = a; k <= b; k++) selected.add(items[k].id);
    } else if (e.metaKey || e.ctrlKey) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
    } else if (selected.size === 1 && selected.has(id)) {
      selected.clear();
    } else {
      selected.clear();
      selected.add(id);
    }
    lastClicked = i;
    syncSelection();
    onChange(api);
  }

  function syncSelection() {
    Array.from(el.children).forEach((cell, i) => cell.setAttribute('aria-selected', String(selected.has(items[i].id))));
  }

  function targets() {
    return selected.size ? items.filter((it) => selected.has(it.id)) : items;
  }

  function turn(i, deg) {
    const list = selected.size && selected.has(items[i].id) ? targets() : [items[i]];
    list.forEach((it) => { it.rotate = (((it.rotate + deg) % 360) + 360) % 360; });
    render();
  }

  function cut(i) {
    const list = selected.size && selected.has(items[i].id) ? targets() : [items[i]];
    const to = !list.every((it) => it.cut);
    list.forEach((it) => { it.cut = to; });
    render();
  }

  function duplicate(i) {
    const list = selected.size && selected.has(items[i].id) ? targets() : [items[i]];
    const at = items.indexOf(list[list.length - 1]) + 1;
    items.splice(at, 0, ...list.map((it, k) => ({ ...it, id: `${it.id}-copy${Date.now()}${k}` })));
    render();
  }

  const api = {
    el,
    get items() { return items; },
    get kept() { return items.filter((it) => !it.cut); },
    get selected() { return selected; },
    get selectedItems() { return items.filter((it) => selected.has(it.id)); },
    selectAll() { items.forEach((it) => selected.add(it.id)); syncSelection(); onChange(api); },
    selectNone() { selected.clear(); syncSelection(); onChange(api); },
    invert() { items.forEach((it) => (selected.has(it.id) ? selected.delete(it.id) : selected.add(it.id))); syncSelection(); onChange(api); },
    selectIndices(indices) { selected.clear(); indices.forEach((i) => items[i] && selected.add(items[i].id)); syncSelection(); onChange(api); },
    turnSelected(deg) { targets().forEach((it) => { it.rotate = (((it.rotate + deg) % 360) + 360) % 360; }); render(); },
    cutSelected(state) { const list = targets(); const to = state ?? !list.every((it) => it.cut); list.forEach((it) => { it.cut = to; }); render(); },
    keepOnlySelected() { if (!selected.size) return; items.forEach((it) => { it.cut = !selected.has(it.id); }); render(); },
    reverse() { items.reverse(); render(); },
    reset() { items = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, src: i, rotate: 0, cut: false })); selected.clear(); render(); },
    setThumbSize(px) { el.style.setProperty('--thumb', `${px}px`); },
    render,
    destroy() { observer.disconnect(); cache.clear(); },
  };

  render();
  return api;
}
