import { h, icon } from './kit.js';

const root = () => document.getElementById('toaster');

export function toast(message, kind = 'info', ms = 4200) {
  const el = h(`div.toast.toast--${kind}`, [
    icon(kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info', 16),
    h('div', message),
    h('button.toast__x', { type: 'button', 'aria-label': 'Dismiss', onclick: () => el.remove() }, icon('x', 14)),
  ]);
  root().append(el);
  if (ms) setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .2s'; setTimeout(() => el.remove(), 220); }, ms);
  return el;
}

export const ok = (m) => toast(m, 'ok');
export const fail = (m) => toast(m, 'error', 7000);

/** Modal with a promise result. Fields is an array of {name,label,type,value}. */
export function ask({ title, body, fields = [], confirm = 'Continue', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const inputs = {};
    const form = h('form.modal__body');
    if (body) form.append(h('p', body));
    for (const f of fields) {
      const input = h('input', { type: f.type || 'text', value: f.value || '', placeholder: f.placeholder || '', name: f.name });
      inputs[f.name] = input;
      form.append(h('label.field', [h('span.field__label', f.label), input, f.hint && h('span.field__hint', f.hint)]));
    }
    const close = (val) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      h('div.modal__head', title),
      form,
      h('div.modal__foot', [
        h('button.btn', { type: 'button', onclick: () => close(null) }, cancel),
        h(`button.btn.${danger ? 'btn--danger' : 'btn--primary'}`, { type: 'submit', form: 'modal-form' }, confirm),
      ]),
    ]);
    form.id = 'modal-form';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = {};
      for (const [k, el] of Object.entries(inputs)) out[k] = el.value;
      close(fields.length ? out : true);
    });
    const back = h('div.modal-back', { onclick: (e) => { if (e.target === back) close(null); } }, modal);
    document.getElementById('modal-root').append(back);
    document.addEventListener('keydown', onKey);
    (form.querySelector('input') || modal.querySelector('.btn--primary')).focus();
  });
}
