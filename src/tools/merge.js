import { workbench } from '../ui/workbench.js';
import { pdflib } from '../core/lib.js';
import { openDoc, saveDoc } from '../core/pdf.js';
import { setOutline } from '../core/outline.js';
import { stem, plural } from '../ui/kit.js';

export default function mount(host, tool) {
  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: true,
    min: 2,
    action: 'Merge into one PDF',
    actionIcon: 'merge',
    dropTitle: 'Choose the PDFs to merge, or drop them here',
    dropHint: 'Two or more files — you can reorder them afterwards',

    fields: [
      { name: 'outName', type: 'text', label: 'Save as', value: 'merged.pdf' },
      {
        name: 'bookmarks', type: 'checkbox', value: true,
        label: 'Bookmark each source file',
        hint: 'Adds an outline entry pointing at the first page of every file.',
      },
      {
        name: 'blank', type: 'checkbox', value: false,
        label: 'Blank page between files',
        hint: 'Keeps double-sided printing from running two documents together.',
      },
      {
        name: 'evenPages', type: 'checkbox', value: false,
        label: 'Pad each file to an even page count',
        hint: 'Every file then starts on a right-hand page.',
      },
    ],

    async run(api) {
      const { PDFDocument } = await pdflib();
      const out = await PDFDocument.create();
      const { values, files } = api;
      const marks = [];
      let written = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await api.progress(i / files.length, `Reading ${file.name}…`);
        const src = await openDoc(file);
        const indices = src.getPageIndices();
        const copied = await out.copyPages(src, indices);

        marks.push({ title: stem(file.name), pageIndex: written });
        copied.forEach((page) => { out.addPage(page); written++; });

        const needsPad = values.evenPages && written % 2 === 1;
        const wantsBlank = values.blank && i < files.length - 1;
        if (needsPad || wantsBlank) {
          const last = out.getPage(written - 1);
          const { width, height } = last.getSize();
          if (needsPad) { out.addPage([width, height]); written++; }
          if (wantsBlank && !needsPad) { out.addPage([width, height]); written++; }
        }
      }

      if (values.bookmarks) {
        await api.progress(0.9, 'Writing bookmarks…');
        await setOutline(out, marks);
      }

      out.setProducer('Quire');
      out.setCreator('Quire');
      out.setModificationDate(new Date());
      const first = files[0];
      out.setTitle(stem(first.name));

      await api.progress(0.95, 'Saving…');
      const bytes = await saveDoc(out);
      const name = (values.outName || 'merged.pdf').replace(/(\.pdf)?$/i, '.pdf');
      await api.done([{ name, data: bytes, note: `${plural(written, 'page')} from ${plural(files.length, 'file')}` }]);
    },
  });
}
