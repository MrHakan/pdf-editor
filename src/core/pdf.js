import { pdflib, pdfjs, pdfjsAssets, fontkit } from './lib.js';
import { ask } from '../ui/toast.js';
import { noteBytes, notePages } from './monitor.js';

/** A password-protected file needs the same password for both readers, so it is
 *  asked for once and remembered on the file handle for the rest of the session. */
const passwords = new WeakMap();

export async function readBytes(file) {
  const buf = await file.arrayBuffer();
  noteBytes(buf.byteLength);
  return new Uint8Array(buf);
}

const looksEncrypted = (err) => /encrypt|password/i.test(err?.message || '') || err?.name === 'PasswordException';

/**
 * Open a file with pdf-lib for editing. Prompts for a password when the
 * document is protected, unless one was already supplied.
 */
export async function openDoc(file, opts = {}) {
  const { PDFDocument } = await pdflib();
  const bytes = opts.bytes || await readBytes(file);
  let password = opts.password ?? passwords.get(file) ?? undefined;

  for (let attempt = 0; ; attempt++) {
    try {
      const doc = await PDFDocument.load(bytes, {
        password,
        ignoreEncryption: opts.ignoreEncryption || false,
        updateMetadata: false,
        throwOnInvalidObject: false,
      });
      if (password) passwords.set(file, password);
      return doc;
    } catch (err) {
      if (!looksEncrypted(err) || opts.noPrompt || attempt > 3) throw err;
      const answer = await ask({
        title: 'This file is password protected',
        body: `${file.name} needs its open password before Quire can read it. The password stays in this tab.`,
        fields: [{ name: 'pw', label: 'Password', type: 'password', value: '' }],
        confirm: 'Unlock',
      });
      if (!answer) throw new Error('Cancelled — no password given.');
      password = answer.pw;
    }
  }
}

/** Open a file with PDF.js for rendering. Shares the remembered password. */
export async function openViewer(file, opts = {}) {
  const pdfjsLib = await pdfjs();
  const bytes = opts.bytes || await readBytes(file);
  let password = opts.password ?? passwords.get(file) ?? undefined;

  for (let attempt = 0; ; attempt++) {
    try {
      // PDF.js takes ownership of the buffer, so hand it a copy.
      const task = pdfjsLib.getDocument({ data: bytes.slice(), password, ...pdfjsAssets, isEvalSupported: false });
      const doc = await task.promise;
      if (password) passwords.set(file, password);
      return doc;
    } catch (err) {
      if (!looksEncrypted(err) || opts.noPrompt || attempt > 3) throw err;
      const answer = await ask({
        title: 'This file is password protected',
        body: `${file.name} needs its open password before Quire can show it.`,
        fields: [{ name: 'pw', label: 'Password', type: 'password', value: '' }],
        confirm: 'Unlock',
      });
      if (!answer) throw new Error('Cancelled — no password given.');
      password = answer.pw;
    }
  }
}

export function rememberPassword(file, password) { if (password) passwords.set(file, password); }
export function knownPassword(file) { return passwords.get(file); }

/** Render one PDF.js page onto a fresh canvas at the given scale. */
export async function renderPage(page, scale = 1, { canvas, background = '#ffffff' } = {}) {
  const viewport = page.getViewport({ scale });
  const c = canvas || document.createElement('canvas');
  const dpr = canvas ? 1 : 1;
  c.width = Math.max(1, Math.floor(viewport.width * dpr));
  c.height = Math.max(1, Math.floor(viewport.height * dpr));
  c.style.width = `${Math.floor(viewport.width)}px`;
  c.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = c.getContext('2d', { alpha: false });
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport, background }).promise;
  notePages(1);
  return c;
}

/** Scale that fits a page into a box of `maxPx` on its longest side. */
export function fitScale(page, maxPx) {
  const vp = page.getViewport({ scale: 1 });
  return Math.min(maxPx / vp.width, maxPx / vp.height, 4);
}

/** Small preview image for grids and file rows. */
export async function thumbnail(doc, pageNo, maxPx = 180, type = 'image/jpeg', quality = 0.72) {
  const page = await doc.getPage(pageNo);
  const canvas = await renderPage(page, fitScale(page, maxPx));
  const url = canvas.toDataURL(type, quality);
  page.cleanup();
  return url;
}

/** Register fontkit once per document so custom TTFs can be embedded. */
export async function withFontkit(doc) {
  if (doc.__quireFontkit) return doc;
  doc.registerFontkit(await fontkit());
  doc.__quireFontkit = true;
  return doc;
}

export async function saveDoc(doc, opts = {}) {
  const bytes = await doc.save({ useObjectStreams: opts.useObjectStreams !== false, ...opts });
  noteBytes(bytes.byteLength);
  return bytes;
}

/** Copy a set of pages (0-based indices) from one document into a new one. */
export async function extractPages(srcDoc, indices) {
  const { PDFDocument } = await pdflib();
  const out = await PDFDocument.create();
  const copied = await out.copyPages(srcDoc, indices);
  copied.forEach((p) => out.addPage(p));
  return out;
}

/** Carry over the title/author/etc. so derived files keep their identity. */
export function copyMetadata(src, dst, { titleSuffix = '' } = {}) {
  try {
    const title = src.getTitle();
    if (title) dst.setTitle(title + titleSuffix);
    const author = src.getAuthor(); if (author) dst.setAuthor(author);
    const subject = src.getSubject(); if (subject) dst.setSubject(subject);
    const keywords = src.getKeywords(); if (keywords) dst.setKeywords(keywords.split(/[,;]\s*/));
    const creator = src.getCreator(); if (creator) dst.setCreator(creator);
  } catch { /* some documents have unreadable info dictionaries */ }
  dst.setProducer('Quire');
  dst.setModificationDate(new Date());
}

export const PAGE_SIZES = {
  a4: { label: 'A4 · 210 × 297 mm', w: 595.28, h: 841.89 },
  a3: { label: 'A3 · 297 × 420 mm', w: 841.89, h: 1190.55 },
  a5: { label: 'A5 · 148 × 210 mm', w: 419.53, h: 595.28 },
  letter: { label: 'Letter · 8.5 × 11 in', w: 612, h: 792 },
  legal: { label: 'Legal · 8.5 × 14 in', w: 612, h: 1008 },
  tabloid: { label: 'Tabloid · 11 × 17 in', w: 792, h: 1224 },
};

export const MM = 2.834645669;
