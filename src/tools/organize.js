import { workbench } from '../ui/workbench.js';
import { pageGrid } from '../ui/pagegrid.js';
import { pdflib } from '../core/lib.js';
import { openDoc, openViewer, saveDoc, copyMetadata } from '../core/pdf.js';
import { h, icon, plural, stem } from '../ui/kit.js';
import { formatRange } from '../core/range.js';

export default function mount(host, tool) {
  let viewer = null;
  let grid = null;
  let countEl = null;

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Write the new order',
    actionIcon: 'organize',
    dropTitle: 'Choose a PDF to lay out, or drop it here',
    dropHint: 'Every page becomes a thumbnail you can drag, turn or cut',

    async onFiles(a) {
      grid?.destroy();
      grid = null;
      viewer?.destroy();
      viewer = null;
      if (!a.files[0]) return;
      viewer = await openViewer(a.files[0]);
      a.renderStage();
    },

    stage(a, stageEl) {
      if (!viewer) { stageEl.append(h('div.loading', [h('span.spinner'), 'Rendering pages…'])); return; }

      countEl = h('span.stage__hint');
      grid = pageGrid({
        viewer,
        mode: 'organize',
        onChange: (g) => {
          const cut = g.items.filter((it) => it.cut).length;
          const turned = g.items.filter((it) => it.rotate).length;
          countEl.textContent = [
            `${plural(g.kept.length, 'page')} out`,
            cut ? `${cut} cut` : null,
            turned ? `${turned} turned` : null,
            g.selected.size ? `${g.selected.size} selected` : null,
          ].filter(Boolean).join(' · ');
          a.enableRun(g.kept.length > 0);
        },
      });

      const bar = h('div.stage__toolbar', [
        h('button.btn.btn--sm', { type: 'button', onclick: () => grid.selectAll() }, 'All'),
        h('button.btn.btn--sm', { type: 'button', onclick: () => grid.selectNone() }, 'None'),
        h('button.btn.btn--sm', { type: 'button', onclick: () => grid.invert() }, 'Invert'),
        gap(),
        iconBtn('rotate', 'Turn left', () => grid.turnSelected(-90), true),
        iconBtn('rotate', 'Turn right', () => grid.turnSelected(90)),
        iconBtn('trash', 'Cut or restore', () => grid.cutSelected()),
        h('button.btn.btn--sm', { type: 'button', title: 'Keep only what is selected', onclick: () => grid.keepOnlySelected() }, 'Keep only'),
        h('button.btn.btn--sm', { type: 'button', title: 'Reverse the whole order', onclick: () => grid.reverse() }, 'Reverse'),
        h('span.spacer'),
        countEl,
        h('button.btn.btn--sm', { type: 'button', onclick: () => grid.reset() }, [icon('reset', 13), 'Undo all']),
      ]);

      stageEl.append(bar, grid.el, h('p.stage__hint', 'Click to select · Shift-click for a run · Ctrl or ⌘ click to add · drag to reorder'));
    },

    fields: [
      { name: 'outName', type: 'text', label: 'Save as', value: '', placeholder: 'taken from the source file' },
      {
        name: 'thumbs', type: 'range', label: 'Thumbnail size', value: 132, min: 90, max: 260, step: 2, suffix: 'px',
        hint: 'Only changes what you see here.',
      },
      {
        name: 'note', type: 'note', kind: 'info',
        text: 'Selection tools act on the pages you have selected, or on every page when nothing is selected.',
      },
    ],

    onFieldChange(a, name, values) {
      if (name === 'thumbs') grid?.setThumbSize(values.thumbs);
    },

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      if (!grid?.kept.length) return 'Every page is cut — nothing would be written.';
      return null;
    },

    async run(a) {
      const { degrees } = await pdflib();
      const file = a.files[0];
      const src = await openDoc(file);
      const { PDFDocument } = await pdflib();
      const out = await PDFDocument.create();
      const kept = grid.kept;

      await a.progress(0.2, `Copying ${plural(kept.length, 'page')}…`);
      const copied = await out.copyPages(src, kept.map((it) => it.src));
      copied.forEach((page, i) => {
        const turn = kept[i].rotate;
        if (turn) page.setRotation(degrees((page.getRotation().angle + turn + 360) % 360));
        out.addPage(page);
      });

      copyMetadata(src, out);
      await a.progress(0.85, 'Saving…');
      const name = (a.values.outName ? stem(a.values.outName) : `${stem(file.name)}-organized`) + '.pdf';
      await a.done([{
        name,
        data: await saveDoc(out),
        note: `${plural(kept.length, 'page')} · from ${formatRange(kept.map((k) => k.src))}`,
      }]);
    },
  });
}

const gap = () => h('span', { style: { width: '8px' } });

function iconBtn(name, title, onclick, flip = false) {
  const b = h('button.btn.btn--sm', { type: 'button', title, 'aria-label': title, onclick }, icon(name, 14));
  if (flip) b.firstChild.style.transform = 'scaleX(-1)';
  return b;
}
