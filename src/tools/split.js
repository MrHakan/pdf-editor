import { workbench } from '../ui/workbench.js';
import { openDoc, saveDoc, extractPages, copyMetadata } from '../core/pdf.js';
import { parseRange, range } from '../core/range.js';
import { stem, plural } from '../ui/kit.js';
import { pad, safeName } from '../core/files.js';

export default function mount(host, tool) {
  let pageCount = 0;

  const api = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Split the document',
    actionIcon: 'split',
    dropTitle: 'Choose the PDF to split, or drop it here',

    async onFiles(a) {
      pageCount = 0;
      if (!a.files[0]) return;
      const doc = await openDoc(a.files[0]);
      pageCount = doc.getPageCount();
      a.setField('every', Math.min(a.values.every || 1, Math.max(1, pageCount - 1)));
      a.status(`${plural(pageCount, 'page')} loaded`);
    },

    fields: [
      {
        name: 'mode', type: 'segmented', label: 'How to cut it',
        value: 'every',
        options: [
          { value: 'every', label: 'Every N' },
          { value: 'at', label: 'At pages' },
          { value: 'ranges', label: 'Ranges' },
          { value: 'each', label: 'Each page' },
        ],
      },
      {
        name: 'every', type: 'number', label: 'Pages per file', value: 10, min: 1, step: 1,
        when: (v) => v.mode === 'every',
        hint: 'The last file takes whatever is left over.',
      },
      {
        name: 'points', type: 'text', label: 'Start a new file at page', value: '',
        placeholder: '5, 12, 30',
        when: (v) => v.mode === 'at',
        hint: 'Each number listed becomes the first page of a new file.',
      },
      {
        name: 'ranges', type: 'textarea', label: 'One range per line', value: '1-3\n4-8',
        rows: 5,
        when: (v) => v.mode === 'ranges',
        hint: 'Each line becomes its own file. Pages may repeat or be left out.',
      },
      {
        name: 'prefix', type: 'text', label: 'Name the parts', value: '',
        placeholder: 'taken from the source file',
        hint: 'Parts are numbered automatically: name-01.pdf, name-02.pdf …',
      },
      {
        name: 'meta', type: 'checkbox', label: 'Copy the title and author into each part', value: true,
      },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      const v = a.values;
      if (v.mode === 'every' && (!v.every || v.every < 1)) return 'Pages per file has to be at least 1.';
      if (v.mode === 'at' && !String(v.points).trim()) return 'Give at least one page to cut at.';
      if (v.mode === 'ranges' && !String(v.ranges).trim()) return 'Write at least one range.';
      return null;
    },

    async run(a) {
      const file = a.files[0];
      const src = await openDoc(file);
      const total = src.getPageCount();
      const v = a.values;

      const groups = planGroups(v, total);
      if (!groups.length) throw new Error('That plan produced no pages.');

      const base = safeName(v.prefix || stem(file.name));
      const outputs = [];

      for (let i = 0; i < groups.length; i++) {
        await a.progress(i / groups.length, `Writing part ${i + 1} of ${groups.length}…`);
        const doc = await extractPages(src, groups[i]);
        if (v.meta) copyMetadata(src, doc, { titleSuffix: ` (${i + 1}/${groups.length})` });
        const bytes = await saveDoc(doc);
        outputs.push({
          name: `${base}-${pad(i + 1, groups.length)}.pdf`,
          data: bytes,
          note: `${plural(groups[i].length, 'page')} · ${describe(groups[i])}`,
        });
      }

      await a.done(outputs, { zipName: `${base}-split.zip` });
      a.status(`${plural(outputs.length, 'file')} written from ${plural(total, 'page')}`);
    },
  });

  return api;
}

function planGroups(v, total) {
  const all = range(0, total - 1);

  if (v.mode === 'each') return all.map((i) => [i]);

  if (v.mode === 'every') {
    const size = Math.max(1, Number(v.every) || 1);
    const groups = [];
    for (let i = 0; i < total; i += size) groups.push(all.slice(i, i + size));
    return groups;
  }

  if (v.mode === 'at') {
    const cuts = Array.from(new Set(
      String(v.points).split(/[,;\s]+/).filter(Boolean).map((n) => Number(n) - 1),
    )).filter((n) => n > 0 && n < total).sort((a, b) => a - b);
    const groups = [];
    let start = 0;
    for (const cut of cuts) { groups.push(all.slice(start, cut)); start = cut; }
    groups.push(all.slice(start));
    return groups.filter((g) => g.length);
  }

  return String(v.ranges).split(/\n+/).map((line) => line.trim()).filter(Boolean)
    .map((line) => parseRange(line, total)).filter((g) => g.length);
}

function describe(indices) {
  const first = indices[0] + 1;
  const last = indices[indices.length - 1] + 1;
  return first === last ? `page ${first}` : `pages ${first}–${last}`;
}
