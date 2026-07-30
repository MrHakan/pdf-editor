import { workbench } from '../ui/workbench.js';
import { openDoc, saveDoc, extractPages, copyMetadata } from '../core/pdf.js';
import { checkRange, parseRange, formatRange, range } from '../core/range.js';
import { stem, plural } from '../ui/kit.js';
import { pad, safeName } from '../core/files.js';

export default function mount(host, tool) {
  let total = 0;

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Extract the pages',
    actionIcon: 'extract',
    dropTitle: 'Choose a PDF, or drop it here',

    async onFiles(a) {
      total = 0;
      if (!a.files[0]) return;
      const doc = await openDoc(a.files[0]);
      total = doc.getPageCount();
      a.status(`${plural(total, 'page')} loaded`);
      a.refreshFields();
    },

    fields: [
      {
        name: 'pages', type: 'pages', label: 'Pages', value: '1-3',
        check: (spec) => {
          if (!total) return { ok: true, text: '' };
          const res = checkRange(spec, total);
          return res.ok ? { ok: true, text: `${res.count} of ${total}` } : { ok: false, text: 'unreadable' };
        },
      },
      {
        name: 'invert', type: 'checkbox', value: false,
        label: 'Keep everything except those pages',
        hint: 'Turns the range into a delete list.',
      },
      {
        name: 'each', type: 'checkbox', value: false,
        label: 'One file per page',
        hint: 'Otherwise the pages come back as a single document.',
      },
      { name: 'outName', type: 'text', label: 'Save as', value: '', placeholder: 'taken from the source file' },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      const res = checkRange(a.values.pages, total || 1);
      if (!res.ok) return res.error;
      return null;
    },

    async run(a) {
      const file = a.files[0];
      const src = await openDoc(file);
      const count = src.getPageCount();
      const picked = parseRange(a.values.pages, count);
      const wanted = a.values.invert
        ? range(0, count - 1).filter((i) => !picked.includes(i))
        : picked;

      if (!wanted.length) throw new Error('That leaves no pages at all.');

      const base = safeName(a.values.outName ? stem(a.values.outName) : `${stem(file.name)}-pages`);

      if (a.values.each) {
        const outputs = [];
        for (let i = 0; i < wanted.length; i++) {
          await a.progress(i / wanted.length, `Page ${wanted[i] + 1}…`);
          const doc = await extractPages(src, [wanted[i]]);
          copyMetadata(src, doc);
          outputs.push({ name: `${base}-${pad(wanted[i] + 1, count)}.pdf`, data: await saveDoc(doc), note: `page ${wanted[i] + 1}` });
        }
        await a.done(outputs, { zipName: `${base}.zip` });
        return;
      }

      await a.progress(0.4, 'Copying pages…');
      const doc = await extractPages(src, wanted);
      copyMetadata(src, doc);
      await a.progress(0.85, 'Saving…');
      await a.done([{ name: `${base}.pdf`, data: await saveDoc(doc), note: formatRange(wanted) }]);
    },
  });
}
