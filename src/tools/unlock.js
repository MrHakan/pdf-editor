import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { openDoc, saveDoc, readBytes, rememberPassword, copyMetadata } from '../core/pdf.js';
import { stem, plural } from '../ui/kit.js';

export default function mount(host, tool) {
  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: true,
    action: 'Remove the password',
    actionIcon: 'unlock',
    dropTitle: 'Choose protected PDFs, or drop them here',
    dropHint: 'You will be asked for each password that is needed',

    fields: [
      {
        name: 'password', type: 'password', label: 'Password', value: '',
        hint: 'Leave this empty and Quire will ask for each file as it opens it. Used for every file when set.',
      },
      {
        name: 'note', type: 'note', kind: 'warn',
        text: 'This removes protection from a document you can already open. It is not a way into one you cannot — nothing here guesses or breaks a password.',
      },
      { name: 'keepMeta', type: 'checkbox', label: 'Keep the title and author', value: true },
    ],

    async run(a) {
      const { PDFDocument } = await pdflib();
      const password = a.values.password || undefined;
      const outputs = [];

      for (let i = 0; i < a.files.length; i++) {
        const file = a.files[i];
        await a.progress(i / a.files.length, `Opening ${file.name}…`);
        if (password) rememberPassword(file, password);

        const bytes = await readBytes(file);
        // pdf-lib reports isEncrypted as false once it has decrypted, so the
        // raw trailer is what says whether there was protection to remove.
        const wasEncrypted = hasEncryptEntry(bytes);
        const src = await openDoc(file, { bytes, password });

        // Copying into a fresh document is what drops the security handler.
        const out = await PDFDocument.create();
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        if (a.values.keepMeta) copyMetadata(src, out);
        else { out.setProducer('Quire'); out.setModificationDate(new Date()); }

        outputs.push({
          name: `${stem(file.name)}-unlocked.pdf`,
          data: await saveDoc(out),
          note: wasEncrypted ? `${plural(out.getPageCount(), 'page')} · protection removed` : `${plural(out.getPageCount(), 'page')} · was not protected`,
        });
      }

      await a.done(outputs, { zipName: 'unlocked.zip' });
    },
  });
}

/** Look for an /Encrypt entry in the raw bytes. */
function hasEncryptEntry(bytes) {
  const needle = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  outer: for (let i = 0; i < bytes.length - needle.length; i++) {
    for (let k = 0; k < needle.length; k++) if (bytes[i + k] !== needle[k]) continue outer;
    return true;
  }
  return false;
}
