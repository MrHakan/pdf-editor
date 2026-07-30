import { pdflib } from './lib.js';
import { withFontkit } from './pdf.js';

const embedBase = new URL('../../assets/fonts/embed/', import.meta.url);

/**
 * The three built-in PDF families need no embedding but only cover Latin-1, so
 * anything with Turkish, Polish, Greek or Cyrillic text has to fall back to an
 * embedded face. Quire ships Noto for that and switches automatically.
 */
export const FONT_FAMILIES = [
  { id: 'helvetica', label: 'Helvetica', kind: 'standard', unicode: false, faces: { regular: 'Helvetica', bold: 'HelveticaBold', italic: 'HelveticaOblique', boldItalic: 'HelveticaBoldOblique' } },
  { id: 'times', label: 'Times', kind: 'standard', unicode: false, faces: { regular: 'TimesRoman', bold: 'TimesRomanBold', italic: 'TimesRomanItalic', boldItalic: 'TimesRomanBoldItalic' } },
  { id: 'courier', label: 'Courier', kind: 'standard', unicode: false, faces: { regular: 'Courier', bold: 'CourierBold', italic: 'CourierOblique', boldItalic: 'CourierBoldOblique' } },
  { id: 'noto-sans', label: 'Noto Sans (full Unicode)', kind: 'embed', unicode: true, faces: { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf', italic: 'NotoSans-Italic.ttf', boldItalic: 'NotoSans-Bold.ttf' } },
  { id: 'noto-serif', label: 'Noto Serif (full Unicode)', kind: 'embed', unicode: true, faces: { regular: 'NotoSerif-Regular.ttf', bold: 'NotoSerif-Bold.ttf', italic: 'NotoSerif-Regular.ttf', boldItalic: 'NotoSerif-Bold.ttf' } },
  { id: 'noto-mono', label: 'Noto Sans Mono (full Unicode)', kind: 'embed', unicode: true, faces: { regular: 'NotoSansMono-Regular.ttf', bold: 'NotoSansMono-Regular.ttf', italic: 'NotoSansMono-Regular.ttf', boldItalic: 'NotoSansMono-Regular.ttf' } },
];

export const fontOptions = FONT_FAMILIES.map((f) => ({ value: f.id, label: f.label }));

const byId = (id) => FONT_FAMILIES.find((f) => f.id === id) || FONT_FAMILIES[0];

const fileCache = new Map();
async function faceBytes(filename) {
  if (!fileCache.has(filename)) {
    fileCache.set(filename, fetch(new URL(filename, embedBase).href).then((r) => {
      if (!r.ok) throw new Error(`Missing font file ${filename}`);
      return r.arrayBuffer();
    }));
  }
  return fileCache.get(filename);
}

/** Everything WinAnsi can represent; anything else forces an embedded font. */
const WIN_ANSI = /^[\u0000-\u007F\u00A0-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]*$/;

export const needsUnicode = (text) => !WIN_ANSI.test(String(text ?? ''));

/**
 * Embed a face and return it.
 * When `text` is given and the chosen family cannot encode it, the closest
 * Unicode family is used instead and reported back through `substituted`.
 */
export async function embedFont(doc, familyId, { bold = false, italic = false, text = '' } = {}) {
  const { StandardFonts } = await pdflib();
  let family = byId(familyId);
  let substituted = null;

  if (!family.unicode && needsUnicode(text)) {
    const fallback = family.id === 'times' ? 'noto-serif' : family.id === 'courier' ? 'noto-mono' : 'noto-sans';
    substituted = { from: family.label, to: byId(fallback).label };
    family = byId(fallback);
  }

  const key = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
  const face = family.faces[key] || family.faces.regular;

  if (family.kind === 'standard') {
    const font = await doc.embedFont(StandardFonts[face] || StandardFonts.Helvetica);
    return { font, family, substituted };
  }

  await withFontkit(doc);
  const bytes = await faceBytes(face);
  const font = await doc.embedFont(bytes, { subset: true });
  return { font, family, substituted };
}

/** Replace characters a font cannot draw, so a stray glyph never fails a job. */
export function stripUnsupported(font, text) {
  let out = '';
  for (const ch of String(text)) {
    try { font.widthOfTextAtSize(ch, 12); out += ch; }
    catch { out += ch.trim() ? '?' : ch; }
  }
  return out;
}

/** Greedy wrap by measured width. Honours existing line breaks. */
export function wrapText(font, text, size, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    if (!paragraph) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      const candidate = line + word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line.trim()) {
        line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
