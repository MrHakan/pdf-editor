import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { openDoc, saveDoc, copyMetadata } from '../core/pdf.js';
import { readBytes } from '../core/pdf.js';
import { stem, plural, bytes as fmtBytes } from '../ui/kit.js';

/**
 * Rebuild a document from whatever is still readable, and optionally flatten
 * the interactive layer so form values and annotations become page content.
 */
export default function mount(host, tool) {
  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Rebuild the file',
    actionIcon: 'repair',
    dropTitle: 'Choose a PDF that misbehaves, or drop it here',

    fields: [
      {
        name: 'flatten', type: 'checkbox', label: 'Flatten forms and annotations', value: false,
        hint: 'Turns filled fields and comments into ordinary page content that cannot be changed or cleared.',
      },
      { name: 'strip', type: 'checkbox', label: 'Remove JavaScript and embedded files', value: true, hint: 'Actions, scripts and attachments a document carries are dropped.' },
      { name: 'keepMeta', type: 'checkbox', label: 'Keep the title and author', value: true },
      {
        name: 'lenient', type: 'checkbox', label: 'Ignore broken objects', value: true,
        hint: 'Reads past damage instead of stopping. Pages that cannot be read at all are left out and reported.',
      },
      {
        name: 'note', type: 'note', kind: 'info',
        text: 'A rebuild also tends to shrink files that were saved by many rounds of editing, because everything unreferenced is left behind.',
      },
    ],

    async run(a) {
      const { PDFDocument } = await pdflib();
      const file = a.files[0];
      const v = a.values;

      await a.progress(0.15, 'Reading…');
      const raw = await readBytes(file);
      let src;
      try {
        src = await openDoc(file, { bytes: raw });
      } catch (err) {
        if (!v.lenient) throw err;
        await a.progress(0.25, 'Retrying with a looser parser…');
        src = await PDFDocument.load(raw, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
      }

      if (v.flatten) {
        await a.progress(0.4, 'Flattening the form…');
        try { src.getForm().flatten(); }
        catch { a.toast('The form could not be flattened, so it was left as it is.'); }
      }

      if (v.strip) {
        await a.progress(0.5, 'Removing scripts and attachments…');
        stripActions(src, await pdflib());
      }

      await a.progress(0.6, 'Rebuilding page by page…');
      const out = await PDFDocument.create();
      const total = src.getPageCount();
      const lost = [];

      for (let i = 0; i < total; i++) {
        if (i % 10 === 0) await a.progress(0.6 + (i / total) * 0.3, `Page ${i + 1} of ${total}…`);
        try {
          const [page] = await out.copyPages(src, [i]);
          out.addPage(page);
        } catch { lost.push(i + 1); }
      }

      if (!out.getPageCount()) throw new Error('Nothing readable was left in this file. It may be truncated rather than damaged.');
      if (v.keepMeta) copyMetadata(src, out);
      else { out.setProducer('Quire'); out.setModificationDate(new Date()); }

      await a.progress(0.95, 'Saving…');
      const bytes = await saveDoc(out);
      const delta = file.size - bytes.byteLength;

      if (lost.length) a.toast(`${plural(lost.length, 'page')} could not be recovered: ${lost.slice(0, 8).join(', ')}${lost.length > 8 ? '…' : ''}`, 'error');

      await a.done([{
        name: `${stem(file.name)}-repaired.pdf`,
        data: bytes,
        note: `${plural(out.getPageCount(), 'page')} · ${delta > 0 ? `${fmtBytes(delta)} smaller` : fmtBytes(bytes.byteLength)}`,
      }]);
    },
  });
}

/** Drop /OpenAction, /AA, /Names/JavaScript and embedded file trees. */
function stripActions(doc, lib) {
  const { PDFName } = lib;
  try {
    const catalog = doc.catalog;
    catalog.delete(PDFName.of('OpenAction'));
    catalog.delete(PDFName.of('AA'));
    const names = catalog.lookup(PDFName.of('Names'));
    if (names?.delete) {
      names.delete(PDFName.of('JavaScript'));
      names.delete(PDFName.of('EmbeddedFiles'));
    }
    for (const page of doc.getPages()) {
      page.node.delete(PDFName.of('AA'));
    }
  } catch { /* nothing to strip */ }
}
