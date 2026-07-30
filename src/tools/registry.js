/**
 * The tool board.
 *
 * Categories are inked like a process colour chart: cyan, magenta and yellow
 * are the primaries, the mixes sit between them, and inspection tools are key
 * black. `load` is a dynamic import, so opening a tool fetches only that tool.
 */

export const CATEGORIES = [
  { id: 'organize', label: 'Organize', ink: '#22B8D6', blurb: 'Rearrange what is already there.' },
  { id: 'convert', label: 'Convert', ink: '#3DBE8B', blurb: 'Move between PDF and everything else.' },
  { id: 'edit', label: 'Edit', ink: '#E5B12E', blurb: 'Put new marks on the page.' },
  { id: 'optimize', label: 'Optimize', ink: '#9B7BEA', blurb: 'Make files smaller and better behaved.' },
  { id: 'secure', label: 'Secure', ink: '#E0457B', blurb: 'Control who can open and copy.' },
  { id: 'inspect', label: 'Inspect', ink: '#8B98A8', blurb: 'Read what a document is carrying.' },
];

const ink = (id) => CATEGORIES.find((c) => c.id === id).ink;

const defs = [
  {
    id: 'merge', name: 'Merge PDFs', cat: 'organize', icon: 'merge',
    desc: 'Combine several files into one, in the order you choose.',
    long: 'Add as many PDFs as you like, drag them into the order you want, and write them out as a single document. Bookmarks are rebuilt so each source file stays findable.',
    keys: 'combine join append concatenate',
    load: () => import('./merge.js'),
  },
  {
    id: 'split', name: 'Split PDF', cat: 'organize', icon: 'split',
    desc: 'Cut one document into several, by range, count or bookmark.',
    long: 'Break a document apart: at fixed intervals, at page numbers you pick, into one file per page, or into chunks under a size you set.',
    keys: 'cut divide separate chapters burst',
    load: () => import('./split.js'),
  },
  {
    id: 'organize', name: 'Organize pages', cat: 'organize', icon: 'organize',
    desc: 'Reorder, turn, duplicate and drop pages on a light table.',
    long: 'The whole document as thumbnails. Drag pages into a new order, turn them, duplicate them, mark the ones to remove, then write the result.',
    keys: 'reorder rotate delete remove sort rearrange move',
    load: () => import('./organize.js'),
  },
  {
    id: 'extract', name: 'Extract pages', cat: 'organize', icon: 'extract',
    desc: 'Pull a range of pages into a document of its own.',
    long: 'Keep the pages you name and leave the rest behind — as one file, or as one file per page.',
    keys: 'take copy subset select range',
    load: () => import('./extract.js'),
  },
  {
    id: 'impose', name: 'Impose sheets', cat: 'organize', icon: 'impose',
    desc: 'Two or four pages per sheet, or a folded booklet.',
    long: 'Lay several pages onto each printed sheet to save paper, or reorder a document into booklet signatures so it reads correctly once folded and stapled.',
    keys: 'n-up 2up 4up booklet signature print layout paper saver',
    load: () => import('./impose.js'),
  },

  {
    id: 'images-to-pdf', name: 'Images to PDF', cat: 'convert', icon: 'imagesToPdf',
    desc: 'Turn JPG, PNG, WebP or GIF files into pages.',
    long: 'Drop in photos or scans and get a PDF. Choose the page size, how each image is fitted, and the margin around it.',
    keys: 'jpg jpeg png webp photo picture scan convert',
    load: () => import('./images-to-pdf.js'),
  },
  {
    id: 'pdf-to-images', name: 'PDF to images', cat: 'convert', icon: 'pdfToImages',
    desc: 'Render pages as PNG, JPG or WebP at any resolution.',
    long: 'Rasterise pages at the DPI you need. One image per page, delivered as a zip when there is more than one.',
    keys: 'png jpg jpeg webp render rasterize export screenshot dpi',
    load: () => import('./pdf-to-images.js'),
  },
  {
    id: 'text-to-pdf', name: 'Text to PDF', cat: 'convert', icon: 'textToPdf',
    desc: 'Typeset plain text or Markdown into a clean document.',
    long: 'Paste text or drop a .txt or .md file. Headings, lists, quotes, rules and code blocks are laid out, with full Unicode support for any language.',
    keys: 'markdown md txt write typeset notes',
    load: () => import('./text-to-pdf.js'),
  },
  {
    id: 'extract-text', name: 'Extract text', cat: 'convert', icon: 'extractText',
    desc: 'Read the words out of a PDF as text or Markdown.',
    long: 'Pull the text layer out of a document, keeping line and paragraph breaks. Per page or as one file.',
    keys: 'copy read words content txt scrape',
    load: () => import('./extract-text.js'),
  },
  {
    id: 'extract-images', name: 'Extract images', cat: 'convert', icon: 'extractImages',
    desc: 'Save every picture embedded in a document.',
    long: 'Walks each page and writes out the images it finds at their original resolution, skipping anything smaller than the size you set.',
    keys: 'pictures photos assets save unpack',
    load: () => import('./extract-images.js'),
  },
  {
    id: 'scan', name: 'Scan with camera', cat: 'convert', icon: 'scan',
    desc: 'Photograph pages with your camera and bind them into a PDF.',
    long: 'Uses the camera on this device to capture pages one at a time, with a grayscale and contrast pass that makes paper look scanned rather than photographed.',
    keys: 'camera webcam photo document capture mobile',
    load: () => import('./scan.js'),
  },

  {
    id: 'annotate', name: 'Edit & annotate', cat: 'edit', icon: 'annotate',
    desc: 'Add text, images, shapes, highlights and freehand marks.',
    long: 'A canvas over your page. Place text in any language, drop in images, draw boxes, arrows and highlights, then write everything into the PDF.',
    keys: 'draw write add text box arrow highlight comment markup edit',
    load: () => import('./annotate.js'),
  },
  {
    id: 'sign', name: 'Sign PDF', cat: 'edit', icon: 'sign',
    desc: 'Draw, type or upload a signature and place it on the page.',
    long: 'Sign with a pointer or finger, type your name in a handwriting-like face, or bring in an image of your signature. Save it for the rest of the session and stamp it wherever it belongs.',
    keys: 'signature initials sign name approve',
    load: () => import('./sign.js'),
  },
  {
    id: 'watermark', name: 'Watermark', cat: 'edit', icon: 'watermark',
    desc: 'Stamp text or a logo across the pages you choose.',
    long: 'Tiled or single, behind or over the content, at any angle and opacity. Text watermarks support every language.',
    keys: 'stamp draft confidential logo overlay tile brand',
    load: () => import('./watermark.js'),
  },
  {
    id: 'page-numbers', name: 'Page numbers', cat: 'edit', icon: 'pageNumbers',
    desc: 'Number the pages, with a header or footer if you want one.',
    long: 'Choose the position, the format, where numbering starts and which pages get a number. Roman numerals and "Page 3 of 40" are built in.',
    keys: 'folio pagination header footer numbering bates',
    load: () => import('./page-numbers.js'),
  },
  {
    id: 'resize', name: 'Resize & crop', cat: 'edit', icon: 'resize',
    desc: 'Change the page size, trim the margins or add space.',
    long: 'Scale pages to a standard size, crop away scanner borders by dragging on the page, or grow the margins to leave room for notes and binding.',
    keys: 'crop trim scale a4 letter margin bleed page size',
    load: () => import('./resize.js'),
  },
  {
    id: 'redact', name: 'Redact', cat: 'edit', icon: 'redact',
    desc: 'Black out content and destroy what was underneath.',
    long: 'Draw over anything that must not be readable. Redacted pages are rebuilt as images, so the text underneath is gone rather than hidden — check the result before you send it.',
    keys: 'black out hide remove censor confidential gdpr',
    load: () => import('./redact.js'),
  },
  {
    id: 'forms', name: 'Fill forms', cat: 'edit', icon: 'forms',
    desc: 'Complete interactive form fields and lock them if you like.',
    long: 'Lists every field a PDF form declares, fills them in, and can flatten the result so the answers become part of the page.',
    keys: 'acroform fields fill flatten checkbox input application',
    load: () => import('./forms.js'),
  },

  {
    id: 'compress', name: 'Compress PDF', cat: 'optimize', icon: 'compress',
    desc: 'Shrink a file by resampling its images.',
    long: 'Three levels of loss, from a light clean-up that keeps text sharp to a heavy pass for email attachments. You see the saving before you save the file.',
    keys: 'smaller reduce size optimize shrink email',
    load: () => import('./compress.js'),
  },
  {
    id: 'repair', name: 'Repair & flatten', cat: 'optimize', icon: 'repair',
    desc: 'Rebuild a damaged file, or flatten forms and layers.',
    long: 'Reads whatever is still readable and writes a clean document from it. Can also flatten form fields and annotations into the page so they stop moving.',
    keys: 'fix broken corrupt rebuild flatten damaged recover',
    load: () => import('./repair.js'),
  },

  {
    id: 'protect', name: 'Protect with password', cat: 'secure', icon: 'protect',
    desc: 'Encrypt a document and set what readers may do.',
    long: 'AES-256 encryption with an open password, an owner password, and permissions for printing, copying and editing.',
    keys: 'password encrypt lock secure aes permissions',
    load: () => import('./protect.js'),
  },
  {
    id: 'unlock', name: 'Remove password', cat: 'secure', icon: 'unlock',
    desc: 'Take the encryption off a file you can already open.',
    long: 'Give the password you normally type and get a copy that opens without one. It cannot break a password you do not know.',
    keys: 'decrypt unprotect remove password open',
    load: () => import('./unlock.js'),
  },

  {
    id: 'metadata', name: 'Edit metadata', cat: 'inspect', icon: 'metadata',
    desc: 'Read and rewrite the title, author, dates and more.',
    long: 'Shows everything the document says about itself, lets you change it, and can strip it all out before you hand the file on.',
    keys: 'properties title author subject keywords strip privacy exif',
    load: () => import('./metadata.js'),
  },
  {
    id: 'compare', name: 'Compare PDFs', cat: 'inspect', icon: 'compare',
    desc: 'See what changed between two versions, page by page.',
    long: 'Renders both documents and highlights the pixels that differ, with a text-level summary of the lines that were added or removed.',
    keys: 'diff difference versions changes review two',
    load: () => import('./compare.js'),
  },
  {
    id: 'ocr', name: 'Make searchable', cat: 'inspect', icon: 'ocr', badge: 'beta',
    desc: 'Read text off scanned pages and lay it back over the image.',
    long: 'Runs optical character recognition on scanned pages in this tab and writes an invisible text layer underneath the picture, so the document becomes searchable and copyable.',
    keys: 'ocr scan recognise recognize searchable text layer tesseract',
    load: () => import('./ocr.js'),
  },
];

export const TOOLS = defs.map((t) => ({
  ...t,
  category: CATEGORIES.find((c) => c.id === t.cat).label,
  ink: ink(t.cat),
}));

export const byId = (id) => TOOLS.find((t) => t.id === id);

/** Loose scoring search over name, description and keywords. */
export function searchTools(query) {
  const q = query.trim().toLowerCase();
  if (!q) return TOOLS;
  const terms = q.split(/\s+/);
  return TOOLS
    .map((t) => {
      const hay = `${t.name} ${t.desc} ${t.keys} ${t.category}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (t.name.toLowerCase().startsWith(term)) score += 6;
        else if (t.name.toLowerCase().includes(term)) score += 4;
        else if (t.keys.includes(term)) score += 2;
        else if (hay.includes(term)) score += 1;
        else return null;
      }
      return { t, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.t);
}
