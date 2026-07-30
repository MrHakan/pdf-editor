/** Tiny DOM helpers. Everything in Quire is built with these instead of a framework. */

/**
 * h('div.card', { onclick }, [child, 'text'])
 * Tag string supports `tag.class.class#id`.
 */
export function h(tag, props = null, children = null) {
  if (Array.isArray(props) || typeof props === 'string' || props instanceof Node) {
    children = props;
    props = null;
  }
  // `div.card`, `section#tools`, `section.board#tools` — the id may sit on any
  // part, so it is pulled out before the classes are read.
  let selector = String(tag);
  let id = '';
  const hash = selector.indexOf('#');
  if (hash >= 0) {
    const rest = selector.slice(hash + 1);
    const stop = rest.indexOf('.');
    id = stop >= 0 ? rest.slice(0, stop) : rest;
    selector = selector.slice(0, hash) + (stop >= 0 ? rest.slice(stop) : '');
  }
  const [name, ...classes] = selector.split('.');
  const el = document.createElement(name || 'div');
  if (id) el.id = id;
  if (classes.length) el.className = classes.filter(Boolean).join(' ');

  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class' || k === 'className') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  if (children === null || children === undefined || children === false) return el;
  if (Array.isArray(children)) { children.forEach((c) => append(el, c)); return el; }
  el.append(children instanceof Node ? children : document.createTextNode(String(children)));
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Inline SVG from a raw path string. */
export function svg(paths, size = 20, opts = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('fill', opts.fill || 'none');
  el.setAttribute('stroke', opts.stroke || 'currentColor');
  el.setAttribute('stroke-width', opts.width || 1.5);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = paths;
  return el;
}

/** Human-readable byte count. */
export function bytes(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n < 1000) return `${n} B`;
  const units = ['kB', 'MB', 'GB'];
  let v = n / 1024, i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Strip the extension so tools can build sensible output names. */
export function stem(name = 'document') {
  return name.replace(/\.[a-z0-9]{1,6}$/i, '') || 'document';
}

/** Wait a frame so long loops can paint progress. */
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
