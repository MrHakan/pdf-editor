import { pdflib } from './lib.js';

/**
 * Write a flat bookmark tree. pdf-lib has no outline API, so the objects are
 * assembled by hand: one dictionary per entry, linked with /Prev and /Next and
 * hung off a /Outlines node in the catalog.
 */
export async function setOutline(doc, entries) {
  if (!entries?.length) return;
  const { PDFName, PDFNumber, PDFDict, PDFHexString, PDFNull } = await pdflib();
  const ctx = doc.context;
  const pages = doc.getPages();
  if (!pages.length) return;

  const outlinesRef = ctx.nextRef();
  const refs = entries.map(() => ctx.nextRef());

  entries.forEach((entry, i) => {
    const page = pages[Math.max(0, Math.min(entry.pageIndex | 0, pages.length - 1))];
    const dest = ctx.obj([page.ref, PDFName.of('XYZ'), PDFNull, PDFNumber.of(page.getSize().height), PDFNull]);

    const map = new Map();
    map.set(PDFName.of('Title'), PDFHexString.fromText(String(entry.title || `Page ${entry.pageIndex + 1}`)));
    map.set(PDFName.of('Parent'), outlinesRef);
    map.set(PDFName.of('Dest'), dest);
    if (i > 0) map.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < entries.length - 1) map.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], PDFDict.fromMapWithContext(map, ctx));
  });

  const root = new Map();
  root.set(PDFName.of('Type'), PDFName.of('Outlines'));
  root.set(PDFName.of('First'), refs[0]);
  root.set(PDFName.of('Last'), refs[refs.length - 1]);
  root.set(PDFName.of('Count'), PDFNumber.of(entries.length));
  ctx.assign(outlinesRef, PDFDict.fromMapWithContext(root, ctx));

  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Read the existing bookmark titles and their target pages, best effort. */
export async function readOutline(viewer) {
  try {
    const raw = await viewer.getOutline();
    if (!raw?.length) return [];
    const out = [];
    const walk = async (nodes, depth) => {
      for (const node of nodes) {
        let pageIndex = null;
        try {
          const dest = typeof node.dest === 'string' ? await viewer.getDestination(node.dest) : node.dest;
          if (dest?.[0]) pageIndex = await viewer.getPageIndex(dest[0]);
        } catch { /* broken destination */ }
        out.push({ title: node.title, pageIndex, depth });
        if (node.items?.length) await walk(node.items, depth + 1);
      }
    };
    await walk(raw, 0);
    return out;
  } catch { return []; }
}
