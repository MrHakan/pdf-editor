import { svg } from './dom.js';

/* A single-weight line set drawn on a 24px grid. Sheets are 3.5→20.5 tall so
   the whole set optically aligns when tools sit next to each other. */
const P = {
  /* tools */
  merge: '<path d="M4 5.5h6.5v5H4zM13.5 13.5H20v5h-6.5z"/><path d="M7.2 10.5v4.2a1.8 1.8 0 0 0 1.8 1.8h4.5"/><path d="m11.6 14.4 1.9 1.6-1.9 1.6"/>',
  split: '<path d="M6 3.5h9l3.5 3.5v13H6z"/><path d="M15 3.5V7h3.5"/><path d="M3 12h18" stroke-dasharray="2.4 2.2"/>',
  organize: '<rect x="3.5" y="4" width="7" height="7" rx="1"/><rect x="13.5" y="4" width="7" height="7" rx="1"/><rect x="3.5" y="13.5" width="7" height="7" rx="1"/><path d="M17 14.5v5.5M14.2 17.2h5.6"/>',
  extract: '<path d="M5 3.5h8l3.5 3.5v6"/><path d="M13 3.5V7h3.5"/><path d="M5 3.5v17h5"/><rect x="12.5" y="13.5" width="8" height="7" rx="1"/>',
  impose: '<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M12 4.5v15M3.5 12h17"/><path d="M6.4 8.2h2.6M15 8.2h2.6M6.4 15.7h2.6M15 15.7h2.6" opacity=".55"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.2 4v4.4h-4.4"/>',

  imagesToPdf: '<rect x="3.5" y="5" width="11" height="9" rx="1"/><path d="m3.5 11.4 2.8-2.4 3 2.6 2-1.6 3.2 2.6"/><circle cx="11.4" cy="8" r="1"/><path d="M9.5 19.5h8a2 2 0 0 0 2-2v-8"/><path d="m17 17 2.5 2.5L17 22" transform="translate(0 -2.4)"/>',
  pdfToImages: '<path d="M4 3.5h8l3.5 3.5v6.5"/><path d="M12 3.5V7h3.5"/><path d="M4 3.5v17h4.5"/><rect x="11" y="12.5" width="9.5" height="8" rx="1"/><path d="m11 18.4 2.3-2 2.4 2.1 1.5-1.2 3.3 2.6"/>',
  textToPdf: '<path d="M4.5 6.5V4.5h9v2M9 4.5v9M7 13.5h4"/><path d="M14.5 9.5h5v11h-9v-4"/><path d="M13.4 17.5h3.6M13.4 14.2h3.6" opacity=".6"/>',
  extractText: '<path d="M5 3.5h8l3.5 3.5v13H5z"/><path d="M13 3.5V7h3.5"/><path d="M8 11h5.5M8 14.2h5.5M8 17.4h3.4"/>',
  extractImages: '<path d="M5 3.5h8l3.5 3.5v13H5z"/><path d="M13 3.5V7h3.5"/><rect x="7.8" y="10.5" width="6.4" height="5.4" rx=".8"/><path d="m7.8 14.4 1.8-1.5 1.8 1.6 1.1-.9 1.7 1.3"/>',
  scan: '<path d="M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16M8 20.5H5.5a2 2 0 0 1-2-2V16"/><path d="M3.5 12h17"/>',

  pageNumbers: '<path d="M5 3.5h9l3.5 3.5v13H5z"/><path d="M14 3.5V7h3.5"/><path d="M8.6 17.4h1.4M9.3 17.4v-3.6l-1 .8"/><path d="M12.6 14.1a1.2 1.2 0 0 1 2.1.8c0 1.1-2.1 1.5-2.1 2.5h2.2"/>',
  watermark: '<path d="M5 3.5h9l3.5 3.5v13H5z"/><path d="M14 3.5V7h3.5"/><path d="m7.6 16.6 6.4-6.4M9.6 17.8l5.2-5.2M6.6 14.2l4.4-4.4" opacity=".8"/>',
  resize: '<rect x="3.5" y="3.5" width="17" height="17" rx="1"/><path d="M8 8h8v8H8z" stroke-dasharray="2.4 2"/><path d="M8 8 4.6 4.6M16 16l3.4 3.4"/>',
  annotate: '<path d="M11.5 4.5H5.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6"/><path d="M17.4 3.6a1.9 1.9 0 0 1 2.7 2.7L13 13.4l-3.4.9.9-3.4Z"/>',
  sign: '<path d="M3.5 17.4c3.6 0 3.6-9.6 6.3-9.6 1.9 0 1 6.4 2.7 6.4 1.4 0 1.6-4 3-4 1.2 0 1 2.6 2.3 2.6.9 0 1.6-.8 2.7-1.9"/><path d="M4 20.5h16" opacity=".5"/>',
  redact: '<path d="M5 3.5h9l3.5 3.5v13H5z"/><path d="M14 3.5V7h3.5"/><rect x="7.6" y="10.4" width="7.6" height="2.3" rx=".4" fill="currentColor" stroke="none"/><rect x="7.6" y="14.8" width="4.8" height="2.3" rx=".4" fill="currentColor" stroke="none"/>',
  forms: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M7 9.4h6M7 14.2h3"/><path d="M14.6 15.6h3.2M16.2 14v3.2" opacity=".7"/>',

  compress: '<path d="M12 3.5v5M12 20.5v-5"/><path d="m9 6 3-2.5L15 6M9 18l3 2.5L15 18"/><rect x="3.5" y="9.6" width="17" height="4.8" rx="1"/>',
  repair: '<path d="M14.6 3.9a4 4 0 0 0 5 5.2l-9.2 9.2a2.2 2.2 0 0 1-3.1-3.1l9.2-9.2a4 4 0 0 0-1.9-2.1Z" transform="translate(0 .4)"/><path d="M4.4 4.4 8 8" opacity=".55"/>',
  protect: '<rect x="4.5" y="10" width="15" height="10.5" rx="1.5"/><path d="M8 10V7.6a4 4 0 0 1 8 0V10"/><path d="M12 14v2.6"/>',
  unlock: '<rect x="4.5" y="10" width="15" height="10.5" rx="1.5"/><path d="M8 10V7.6a4 4 0 0 1 7.6-1.7"/><path d="M12 14v2.6"/>',

  metadata: '<path d="M5 3.5h9l3.5 3.5v13H5z"/><path d="M14 3.5V7h3.5"/><path d="M8 11.4h2.6M8 14.4h2.6M12.6 11.4h2.6M12.6 14.4h2.6" opacity=".85"/>',
  compare: '<path d="M12 3.5v17"/><path d="M4 7.5h4.5v11H4zM15.5 5.5H20v13h-4.5z"/><path d="M9.6 12h1.1M13.2 12h1.1" opacity=".6"/>',
  ocr: '<path d="M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16M8 20.5H5.5a2 2 0 0 1-2-2V16"/><path d="M8.2 15.4 10.8 8.6l2.6 6.8M9 13.4h3.6M15.4 15.4V8.6h1.4a2 2 0 0 1 0 4h-1.4"/>',

  /* interface */
  upload: '<path d="M12 15.5V4.2"/><path d="m7.6 8.4 4.4-4.2 4.4 4.2"/><path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15"/>',
  download: '<path d="M12 3.5v11.8"/><path d="m7.6 11 4.4 4.4 4.4-4.4"/><path d="M4 15v3.5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V15"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.6h5v1.9M6.5 6.5l.9 13a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-13"/><path d="M10.2 10.4v6.4M13.8 10.4v6.4" opacity=".6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  check: '<path d="m5 12.6 4.6 4.4L19 6.6"/>',
  chevL: '<path d="m14.5 5.5-7 6.5 7 6.5"/>',
  chevR: '<path d="m9.5 5.5 7 6.5-7 6.5"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  alert: '<path d="M12 4.3 2.8 20.2h18.4z"/><path d="M12 10v4.2M12 17.2v.1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.4M12 7.8v.1"/>',
  zip: '<path d="M5 3.5h9l3.5 3.5v13H5z"/><path d="M14 3.5V7h3.5"/><path d="M9.8 4v1.6M11.4 5.6v1.6M9.8 7.2v1.6M11.4 8.8v1.6M9.8 10.4v1.6"/><rect x="9.4" y="12.6" width="2.6" height="3.4" rx=".6"/>',
  eye: '<path d="M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="1.6"/><path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h1"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M3.8 4v4.4h4.4"/>',
  cursor: '<path d="m5.5 3.6 13 6.6-5.4 1.8-2.2 5.4z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.4 15.4 4.1 4.1"/>',
  type: '<path d="M4.5 7.2V4.8h15v2.4M12 4.8v14.4M8.6 19.2h6.8"/>',
  square: '<rect x="4.5" y="6.5" width="15" height="11" rx="1"/>',
  pen: '<path d="M3.5 20.5c4.5 0 3-12 7.5-12 3 0 1 7 4 7 2.4 0 3-3.4 5.5-3.4"/>',
  target: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4"/><path d="M12 1.6v4.2M12 18.2v4.2M1.6 12h4.2M18.2 12h4.2"/>',
  shield: '<path d="M12 3.2 5 6v6c0 4.2 2.9 7.4 7 8.8 4.1-1.4 7-4.6 7-8.8V6Z"/><path d="m9.2 12 2 2 3.6-4"/>',
  bolt: '<path d="M13.2 3.5 5.5 13.6h5.3l-.9 6.9 7.6-10.1h-5.2z"/>',
};

export const iconNames = Object.keys(P);

/** icon('merge', 20) → <svg> */
export function icon(name, size = 20, opts) {
  return svg(P[name] || P.info, size, opts);
}

export function iconMarkup(name) { return P[name] || P.info; }
