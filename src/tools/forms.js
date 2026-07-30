import { workbench } from '../ui/workbench.js';
import { openDoc, saveDoc, withFontkit } from '../core/pdf.js';
import { pdflib } from '../core/lib.js';
import { embedFont } from '../core/fonts.js';
import { h, clear, icon, stem, plural } from '../ui/kit.js';

/**
 * Fill an interactive form.
 *
 * Everything a PDF form declares is listed here as a matching HTML control, so
 * a form that will not cooperate in a browser's built-in viewer can still be
 * completed and, if you want, frozen into the page.
 */
export default function mount(host, tool) {
  let fieldsEl = null;
  let model = [];

  workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Save the filled form',
    actionIcon: 'forms',
    dropTitle: 'Choose a PDF form, or drop it here',
    plainStage: true,

    async onFiles(a) {
      model = [];
      if (!a.files[0]) return;
      const doc = await openDoc(a.files[0]);
      model = readForm(doc, await pdflib());
      a.renderStage();
      if (!model.length) a.toast('This document has no interactive fields. Use Edit & annotate to write on it instead.', 'error');
      else a.status(`${plural(model.length, 'field')} found`);
    },

    stage(a, stageEl) {
      fieldsEl = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '.75rem', overflowY: 'auto', maxHeight: '66dvh', padding: '.2rem' } });
      stageEl.append(
        h('div.stage__toolbar', [
          h('span.eyebrow', model.length ? `${plural(model.length, 'field')}` : 'No fields'),
          h('span.spacer'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => { model.forEach((f) => { f.value = f.type === 'check' ? false : ''; }); drawFields(); } }, 'Empty all'),
          h('button.btn.btn--sm', { type: 'button', onclick: () => a.pickFiles() }, 'Replace file'),
        ]),
        fieldsEl,
      );
      drawFields();
    },

    fields: [
      {
        name: 'flatten', type: 'checkbox', label: 'Flatten when saving', value: false,
        hint: 'Draws the answers into the page and removes the fields. Nobody can edit or clear them afterwards.',
      },
      { name: 'readOnly', type: 'checkbox', label: 'Lock the fields instead', value: false, hint: 'Keeps the form structure but marks every field read-only.', when: (v) => !v.flatten },
      { name: 'appearance', type: 'checkbox', label: 'Rebuild field appearances', value: true, hint: 'Fixes forms that show nothing until you click into a box.' },
      { name: 'note', type: 'note', kind: 'info', text: 'Field names come from the document itself, which is why some of them read like database columns.' },
    ],

    validate(a) {
      if (!a.files[0]) return 'Choose a PDF first.';
      if (!model.length) return 'This document has no form fields to fill.';
      return null;
    },

    async run(a) {
      const file = a.files[0];
      const doc = await openDoc(file);
      const form = doc.getForm();
      const v = a.values;

      await a.progress(0.3, 'Writing the answers…');
      const problems = [];
      for (const item of model) {
        try {
          const field = form.getField(item.name);
          if (item.type === 'check') item.value ? field.check() : field.uncheck();
          else if (item.type === 'radio') { if (item.value) field.select(item.value); }
          else if (item.type === 'dropdown') { if (item.value) field.select(item.value); }
          else if (item.type === 'optionlist') { if (item.value) field.select(item.value); }
          else field.setText(String(item.value ?? ''));
        } catch (err) { problems.push(`${item.name}: ${err.message}`); }
      }

      if (v.appearance) {
        await a.progress(0.6, 'Rebuilding appearances…');
        try {
          await withFontkit(doc);
          const { font } = await embedFont(doc, 'noto-sans', { text: model.map((m) => String(m.value ?? '')).join('') });
          form.updateFieldAppearances(font);
        } catch { /* the form keeps whatever appearances it had */ }
      }

      if (v.flatten) {
        await a.progress(0.75, 'Flattening…');
        try { form.flatten(); } catch (err) { problems.push(`Flatten failed: ${err.message}`); }
      } else if (v.readOnly) {
        for (const item of model) {
          try { form.getField(item.name).enableReadOnly(); } catch { /* some field types cannot */ }
        }
      }

      if (problems.length) a.toast(`${plural(problems.length, 'field')} could not be written. ${problems[0]}`, 'error');

      await a.progress(0.9, 'Saving…');
      await a.done([{
        name: `${stem(file.name)}-filled.pdf`,
        data: await saveDoc(doc, { updateFieldAppearances: false }),
        note: v.flatten ? 'flattened' : `${plural(model.length, 'field')} written`,
      }]);
    },
  });

  function drawFields() {
    if (!fieldsEl) return;
    clear(fieldsEl);
    if (!model.length) {
      fieldsEl.append(h('div.notice', [icon('info', 15), h('div', 'Load a PDF that contains an interactive form and its fields will appear here.')]));
      return;
    }

    for (const item of model) {
      let control;
      if (item.type === 'check') {
        const input = h('input', { type: 'checkbox', checked: Boolean(item.value), onchange: (e) => { item.value = e.target.checked; } });
        fieldsEl.append(h('label.check', [input, h('span.check__text', [item.label, h('small', `checkbox · ${item.name}`)])]));
        continue;
      }
      if (item.type === 'dropdown' || item.type === 'radio' || item.type === 'optionlist') {
        control = h('select', { onchange: (e) => { item.value = e.target.value; } }, [
          h('option', { value: '' }, '— not set —'),
          ...item.options.map((o) => h('option', { value: o, selected: o === item.value }, o)),
        ]);
      } else if (item.multiline) {
        control = h('textarea', { rows: 3, oninput: (e) => { item.value = e.target.value; } });
        control.value = item.value || '';
      } else {
        control = h('input', { type: 'text', value: item.value || '', maxlength: item.maxLength || undefined, oninput: (e) => { item.value = e.target.value; } });
      }
      fieldsEl.append(h('div.field', [
        h('span.field__label', [item.label, h('span.field__val', item.type)]),
        control,
        h('span.field__hint', item.name + (item.required ? ' · required' : '')),
      ]));
    }
  }
}

/**
 * Describe every field the document declares, with its current value.
 * Types are matched with `instanceof` against the library's own classes —
 * class names are unreliable because the vendored build is minified.
 */
function readForm(doc, lib) {
  let form;
  try { form = doc.getForm(); } catch { return []; }
  let fields;
  try { fields = form.getFields(); } catch { return []; }

  const { PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFButton, PDFSignature } = lib;

  return fields.map((field) => {
    const name = field.getName();
    const base = { name, label: prettify(name), required: safe(() => field.isRequired(), false) };

    if (PDFCheckBox && field instanceof PDFCheckBox) return { ...base, type: 'check', value: safe(() => field.isChecked(), false) };
    if (PDFRadioGroup && field instanceof PDFRadioGroup) return { ...base, type: 'radio', options: safe(() => field.getOptions(), []), value: safe(() => field.getSelected(), '') };
    if (PDFDropdown && field instanceof PDFDropdown) return { ...base, type: 'dropdown', options: safe(() => field.getOptions(), []), value: safe(() => field.getSelected()?.[0], '') };
    if (PDFOptionList && field instanceof PDFOptionList) return { ...base, type: 'optionlist', options: safe(() => field.getOptions(), []), value: safe(() => field.getSelected()?.[0], '') };
    if ((PDFButton && field instanceof PDFButton) || (PDFSignature && field instanceof PDFSignature)) return null;
    return {
      ...base, type: 'text',
      value: safe(() => field.getText(), '') || '',
      multiline: safe(() => field.isMultiline(), false),
      maxLength: safe(() => field.getMaxLength(), 0),
    };
  }).filter(Boolean);
}

/** "applicant_full_name.1" reads better as "Applicant full name". */
function prettify(name) {
  const tail = String(name).split('.').pop();
  const words = tail.replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return words.charAt(0).toUpperCase() + words.slice(1) || name;
}

const safe = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch { return fallback; } };
