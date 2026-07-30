/**
 * Page range parsing: "1-3, 7, 12-" and the shorthands "all", "odd", "even",
 * "last", "-1" (counting back from the end). Returns 0-based indices in the
 * order they were written, so "5,1" really does put page 5 first.
 */
export function parseRange(spec, pageCount) {
  const text = String(spec ?? '').trim().toLowerCase();
  if (!text || text === 'all' || text === '*') return range(0, pageCount - 1);

  const out = [];
  const push = (n) => { if (n >= 0 && n < pageCount) out.push(n); };

  for (const rawPart of text.split(/[,;\s]+/).filter(Boolean)) {
    if (rawPart === 'odd') { for (let i = 0; i < pageCount; i += 2) push(i); continue; }
    if (rawPart === 'even') { for (let i = 1; i < pageCount; i += 2) push(i); continue; }
    if (rawPart === 'last') { push(pageCount - 1); continue; }
    if (rawPart === 'all') { range(0, pageCount - 1).forEach(push); continue; }

    const m = rawPart.match(/^(-?\d+)?\s*(?:(-|–|to|\.\.)\s*(-?\d+)?)?$/);
    if (!m) throw new Error(`"${rawPart}" is not a page number or range.`);

    const hasDash = Boolean(m[2]);
    const a = m[1] !== undefined ? resolve(Number(m[1]), pageCount) : 0;
    const b = hasDash ? (m[3] !== undefined ? resolve(Number(m[3]), pageCount) : pageCount - 1) : a;
    if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`"${rawPart}" is not a page number or range.`);
    if (a <= b) for (let i = a; i <= b; i++) push(i);
    else for (let i = a; i >= b; i--) push(i);
  }
  return out;
}

/** "-1" is the last page, "1" is the first. */
function resolve(n, count) {
  if (n < 0) return count + n;
  return n - 1;
}

export function range(from, to) {
  const out = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

export const unique = (list) => Array.from(new Set(list));

/** Turn [0,1,2,4] into "1-3, 5" for display. */
export function formatRange(indices) {
  const sorted = unique(indices).sort((a, b) => a - b);
  const parts = [];
  let start = null, prev = null;
  for (const i of sorted) {
    if (start === null) { start = prev = i; continue; }
    if (i === prev + 1) { prev = i; continue; }
    parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    start = prev = i;
  }
  if (start !== null) parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
  return parts.join(', ') || '—';
}

/** Validate without throwing — used for live field feedback. */
export function checkRange(spec, pageCount) {
  try {
    const idx = parseRange(spec, pageCount);
    return { ok: true, count: idx.length, indices: idx };
  } catch (err) {
    return { ok: false, error: err.message, count: 0, indices: [] };
  }
}
