import { workbench } from '../ui/workbench.js';
import { openDoc, openViewer, saveDoc } from '../core/pdf.js';
import { h, clear, icon, stem, bytes as fmtBytes, plural } from '../ui/kit.js';

/**
 * Read and rewrite what a document says about itself — including the parts
 * people forget are in there, like the software that made it and the machine's
 * clock when it was last saved.
 */
export default function mount(host, tool) {
  let report = null;

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Save the changes',
    actionIcon: 'metadata',
    dropTitle: 'Choose a PDF to inspect, or drop it here',
    plainStage: true,

    async onFiles(a) {
      if (!a.files[0]) return;
      const file = a.files[0];
      const doc = await openDoc(file);
      const viewer = await openViewer(file);
      const first = doc.getPage(0);
      const size = first?.getSize() || { width: 0, height: 0 };
      let producerInfo = {};
      try { producerInfo = (await viewer.getMetadata())?.info || {}; } catch { /* unreadable info dict */ }

      const facts = [
        ['File', file.name],
        ['Size on disk', fmtBytes(file.size)],
        ['Pages', String(doc.getPageCount())],
        ['First page', `${round(size.width)} × ${round(size.height)} pt · ${round(size.width / 2.8346)} × ${round(size.height / 2.8346)} mm`],
        ['PDF version', producerInfo.PDFFormatVersion || '—'],
        ['Encrypted', doc.isEncrypted ? 'yes' : 'no'],
        ['Form fields', String(safeCount(() => doc.getForm().getFields().length))],
        ['Tagged for accessibility', producerInfo.IsLinearized === undefined ? '—' : (producerInfo.IsAcroFormPresent ? 'has a form' : '—')],
      ];

      a.setField('title', str(() => doc.getTitle()));
      a.setField('author', str(() => doc.getAuthor()));
      a.setField('subject', str(() => doc.getSubject()));
      a.setField('keywords', str(() => doc.getKeywords()));
      a.setField('creator', str(() => doc.getCreator()));
      a.setField('producer', str(() => doc.getProducer()));

      viewer.destroy();
      a.renderStage();
      renderReport(facts, doc);
    },

    stage(a, stageEl) {
      report = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '.9rem' } });
      stageEl.append(
        h('div.stage__toolbar', [h('span.eyebrow', 'What this file is carrying'), h('span.spacer'), h('button.btn.btn--sm', { type: 'button', onclick: () => a.pickFiles() }, 'Replace file')]),
        report,
      );
    },

    fields: [
      { name: 'title', type: 'text', label: 'Title', value: '' },
      { name: 'author', type: 'text', label: 'Author', value: '' },
      { name: 'subject', type: 'text', label: 'Subject', value: '' },
      { name: 'keywords', type: 'text', label: 'Keywords', value: '', hint: 'Separate them with commas.' },
      { name: 'creator', type: 'text', label: 'Created with', value: '' },
      { name: 'producer', type: 'text', label: 'Produced by', value: '' },
      { name: 'heading', type: 'heading', label: 'Dates' },
      { name: 'touchDate', type: 'checkbox', label: 'Set the modified date to now', value: true },
      { name: 'heading2', type: 'heading', label: 'Before you share it' },
      {
        name: 'strip', type: 'checkbox', label: 'Strip everything instead', value: false,
        hint: 'Clears every field above, including the dates and the software names. Overrides what you typed.',
      },
    ],

    validate(a) { return a.files[0] ? null : 'Choose a PDF first.'; },

    async run(a) {
      const file = a.files[0];
      const v = a.values;
      const doc = await openDoc(file);

      await a.progress(0.4, v.strip ? 'Stripping…' : 'Writing…');
      if (v.strip) {
        doc.setTitle('');
        doc.setAuthor('');
        doc.setSubject('');
        doc.setKeywords([]);
        doc.setCreator('');
        doc.setProducer('');
        const epoch = new Date(0);
        doc.setCreationDate(epoch);
        doc.setModificationDate(epoch);
      } else {
        doc.setTitle(v.title || '');
        doc.setAuthor(v.author || '');
        doc.setSubject(v.subject || '');
        doc.setKeywords(String(v.keywords || '').split(/[,;]\s*/).filter(Boolean));
        doc.setCreator(v.creator || '');
        doc.setProducer(v.producer || '');
        if (v.touchDate) doc.setModificationDate(new Date());
      }

      await a.progress(0.85, 'Saving…');
      await a.done([{
        name: `${stem(file.name)}${v.strip ? '-clean' : '-metadata'}.pdf`,
        data: await saveDoc(doc),
        note: v.strip ? 'metadata removed' : 'metadata rewritten',
      }]);
    },
  });

  function renderReport(facts, doc) {
    if (!report) return;
    clear(report);
    const table = h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' } });
    for (const [k, val] of facts) {
      table.append(h('tr', [
        h('td', { style: { padding: '.42rem .6rem', borderBottom: '1px solid var(--line)', color: 'var(--text-3)', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em', width: '42%' } }, k),
        h('td', { style: { padding: '.42rem .6rem', borderBottom: '1px solid var(--line)' } }, val),
      ]));
    }
    report.append(
      h('div', { style: { background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', overflow: 'hidden' } }, table),
      h('div.notice.notice--info', [icon('info', 15), h('div', `Documents often name the software, the account and the exact minute they were saved. If this one is going somewhere public, Strip everything clears all of it before you send it. ${plural(doc.getPageCount(), 'page')} in the file.`)]),
    );
  }
}

const round = (n) => Math.round(n * 10) / 10;
const str = (fn) => { try { return fn() || ''; } catch { return ''; } };
const safeCount = (fn) => { try { return fn(); } catch { return 0; } };
