import { jszip } from './lib.js';
import { noteJob } from './monitor.js';

export function toBlob(data, type = 'application/pdf') {
  if (data instanceof Blob) return data;
  const view = data instanceof Uint8Array ? data : new Uint8Array(data);
  // Copy into a plain ArrayBuffer: some Uint8Arrays are views on a larger buffer.
  return new Blob([view.slice().buffer], { type });
}

/** Hand a file to the browser's download machinery. Nothing is transmitted. */
export function download(data, filename, type) {
  const blob = toBlob(data, type);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  noteJob();
}

/** Bundle several outputs into one archive, built in memory. */
export async function downloadZip(items, filename, onProgress) {
  const JSZip = await jszip();
  const zip = new JSZip();
  for (const item of items) zip.file(item.name, item.blob || item.data);
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => onProgress?.(meta.percent / 100),
  );
  download(blob, filename, 'application/zip');
  return blob;
}

export function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'document';
}

/** Zero-padded index for multi-file outputs, so they sort correctly. */
export const pad = (n, total) => String(n).padStart(String(total).length, '0');

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(Array.from(input.files || [])); input.remove(); }, { once: true });
    document.body.append(input);
    input.click();
  });
}

export function readAsText(file) {
  return file.text();
}

export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

/** Decode an image file into something drawable, preferring the fast path. */
export async function loadImage(fileOrBlob) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(fileOrBlob); } catch { /* fall through for odd formats */ }
  }
  const url = URL.createObjectURL(fileOrBlob);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Unreadable image')); img.src = url; });
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}
