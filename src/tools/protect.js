import { workbench } from '../ui/workbench.js';
import { openDoc, saveDoc } from '../core/pdf.js';
import { stem, h, icon, plural } from '../ui/kit.js';

/**
 * Encrypt a document. @cantoo/pdf-lib writes the standard security handler, so
 * the result opens in any conforming reader with the password you set.
 */
export default function mount(host, tool) {
  const strength = h('div.field__hint');

  const wb = workbench(host, tool, {
    accept: 'application/pdf,.pdf',
    multiple: false,
    action: 'Encrypt the file',
    actionIcon: 'protect',
    dropTitle: 'Choose the PDF to protect, or drop it here',

    fields: [
      { name: 'userPassword', type: 'password', label: 'Password to open the file', value: '', placeholder: 'leave empty for none' },
      { name: 'ownerPassword', type: 'password', label: 'Owner password', value: '', placeholder: 'defaults to the open password', hint: 'Lifts the restrictions below. Give it only to people who may change the document.' },
      { name: 'heading', type: 'heading', label: 'What readers may do' },
      { name: 'printing', type: 'select', label: 'Printing', value: 'highResolution', options: [
        { value: 'highResolution', label: 'Print at full quality' },
        { value: 'lowResolution', label: 'Print at low resolution only' },
        { value: 'no', label: 'No printing' },
      ] },
      { name: 'copying', type: 'checkbox', label: 'Copy text and images', value: true },
      { name: 'modifying', type: 'checkbox', label: 'Change the content', value: false },
      { name: 'annotating', type: 'checkbox', label: 'Add comments and markup', value: true },
      { name: 'fillingForms', type: 'checkbox', label: 'Fill in form fields', value: true },
      { name: 'documentAssembly', type: 'checkbox', label: 'Insert, rotate or delete pages', value: false },
      { name: 'contentAccessibility', type: 'checkbox', label: 'Read aloud by assistive software', value: true, hint: 'Turning this off blocks screen readers. Leave it on unless you have a reason.' },
      {
        name: 'note', type: 'note', kind: 'warn',
        text: 'Permissions are honoured by readers, not enforced by mathematics — the open password is the part that actually protects the file. There is no way to recover a password you forget.',
      },
    ],

    onFieldChange(a) { showStrength(a.values.userPassword); },

    validate(a) {
      const v = a.values;
      if (!a.files[0]) return 'Choose a PDF first.';
      if (!v.userPassword && !v.ownerPassword) return 'Set at least one password.';
      return null;
    },

    async run(a) {
      const v = a.values;
      const file = a.files[0];
      const doc = await openDoc(file);

      await a.progress(0.4, 'Encrypting…');
      doc.encrypt({
        userPassword: v.userPassword || undefined,
        ownerPassword: v.ownerPassword || v.userPassword,
        permissions: {
          printing: v.printing === 'no' ? false : v.printing,
          copying: Boolean(v.copying),
          modifying: Boolean(v.modifying),
          annotating: Boolean(v.annotating),
          fillingForms: Boolean(v.fillingForms),
          documentAssembly: Boolean(v.documentAssembly),
          contentAccessibility: Boolean(v.contentAccessibility),
        },
      });

      await a.progress(0.85, 'Saving…');
      const bytes = await saveDoc(doc, { useObjectStreams: false });
      await a.done([{
        name: `${stem(file.name)}-protected.pdf`,
        data: bytes,
        note: `${plural(doc.getPageCount(), 'page')} · AES-256`,
      }]);
      a.toast('Test the file before you delete the original — a password you cannot reproduce locks you out too.', 'ok');
    },
  });

  wb.panelBody.append(strength);
  showStrength('');
  return wb;

  function showStrength(password) {
    const pw = String(password || '');
    if (!pw) { strength.replaceChildren(); return; }
    const score = rate(pw);
    strength.replaceChildren(h('span', { style: { color: score.color, display: 'inline-flex', gap: '.35rem', alignItems: 'center' } }, [icon(score.ok ? 'check' : 'alert', 12), score.text]));
  }
}

function rate(pw) {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length < 8) return { text: 'Short passwords are guessed quickly — use at least twelve characters.', color: 'var(--danger)', ok: false };
  if (pw.length >= 16 || (pw.length >= 12 && classes >= 3)) return { text: 'Strong enough for a document you care about.', color: 'var(--ok)', ok: true };
  return { text: 'Reasonable. Longer is better than more punctuation.', color: 'var(--warn)', ok: false };
}
