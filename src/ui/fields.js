import { h, clear, icon } from './kit.js';

/**
 * Declarative option panels. A tool describes its controls as data and this
 * builds them, keeps the values object in sync, and handles `when` visibility
 * so panels can react to their own settings.
 */

const ANCHORS = [
  ['top-left', 'Top left'], ['top', 'Top centre'], ['top-right', 'Top right'],
  ['left', 'Middle left'], ['center', 'Centre'], ['right', 'Middle right'],
  ['bottom-left', 'Bottom left'], ['bottom', 'Bottom centre'], ['bottom-right', 'Bottom right'],
];

export function buildFields(container, defs, onChange = () => {}) {
  const values = {};
  const rows = [];

  const api = {
    values,
    get(name) { return values[name]; },
    set(name, v) {
      values[name] = v;
      const row = rows.find((r) => r.def.name === name);
      row?.apply?.(v);
      update();
    },
    /** Re-evaluate `when` clauses and any dynamic label. */
    refresh: update,
    row(name) { return rows.find((r) => r.def.name === name)?.el; },
  };

  function update() {
    for (const r of rows) {
      const visible = !r.def.when || r.def.when(values);
      r.el.hidden = !visible;
      // A row may carry its own updater (the page-range status), or the tool
      // may have declared one on the field.
      (r.update || r.def.update)?.(values, r);
    }
  }

  const fire = (name) => { onChange(values, name, api); update(); };

  for (const def of defs) {
    if (!def) continue;
    const row = makeRow(def, values, fire);
    rows.push(row);
    container.append(row.el);
  }
  update();
  return api;
}

function labelFor(def, extra) {
  return h('span.field__label', [def.label, extra]);
}

function makeRow(def, values, fire) {
  const name = def.name;
  const set = (v) => { values[name] = v; fire(name); };

  switch (def.type) {
    case 'note': {
      const el = h(`div.notice.notice--${def.kind || 'info'}`, [icon(def.kind === 'warn' ? 'alert' : def.kind === 'danger' ? 'alert' : 'info', 15), h('div', def.text)]);
      return { def, el, apply: () => {}, update: def.update };
    }

    case 'heading': {
      return { def, el: h('div.eyebrow', { style: { marginTop: '.2rem' } }, def.label), apply: () => {} };
    }

    case 'checkbox': {
      values[name] = def.value ?? false;
      const input = h('input', { type: 'checkbox', checked: values[name], onchange: (e) => set(e.target.checked) });
      const el = h('label.check', [input, h('span.check__text', [def.label, def.hint && h('small', def.hint)])]);
      return { def, el, apply: (v) => { input.checked = v; } };
    }

    case 'segmented': {
      values[name] = def.value ?? def.options[0].value;
      const group = h('div.segmented', { role: 'group', 'aria-label': def.label });
      const buttons = def.options.map((opt) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(opt.value === values[name]), title: opt.title || opt.label, onclick: () => { set(opt.value); sync(opt.value); } }, opt.label);
        group.append(b);
        return { b, opt };
      });
      const sync = (v) => buttons.forEach(({ b, opt }) => b.setAttribute('aria-pressed', String(opt.value === v)));
      const el = h('div.field', [def.label && labelFor(def), group, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: sync };
    }

    case 'anchor': {
      values[name] = def.value ?? 'bottom-right';
      const grid = h('div.anchor', { role: 'group', 'aria-label': def.label });
      const buttons = ANCHORS.map(([v, title]) => {
        const b = h('button', { type: 'button', title, 'aria-label': title, 'aria-pressed': String(v === values[name]), onclick: () => { set(v); sync(v); } });
        grid.append(b);
        return { b, v };
      });
      const sync = (v) => buttons.forEach(({ b, v: bv }) => b.setAttribute('aria-pressed', String(bv === v)));
      const el = h('div.field', [labelFor(def), grid, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: sync };
    }

    case 'range': {
      values[name] = def.value ?? def.min ?? 0;
      const out = h('span.field__val', formatValue(def, values[name]));
      const input = h('input', {
        type: 'range', min: def.min, max: def.max, step: def.step ?? 1, value: values[name],
        oninput: (e) => { const v = Number(e.target.value); out.textContent = formatValue(def, v); set(v); },
      });
      const el = h('div.field', [labelFor(def, out), input, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: (v) => { input.value = v; out.textContent = formatValue(def, v); } };
    }

    case 'number': {
      values[name] = def.value ?? 0;
      const input = h('input', {
        type: 'number', min: def.min, max: def.max, step: def.step ?? 1, value: values[name],
        oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value)),
      });
      const el = h('div.field', [labelFor(def), input, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: (v) => { input.value = v; } };
    }

    case 'select': {
      const options = typeof def.options === 'function' ? def.options() : def.options;
      values[name] = def.value ?? options[0]?.value;
      const select = h('select', { onchange: (e) => set(e.target.value) },
        options.map((o) => h('option', { value: o.value, selected: o.value === values[name] }, o.label)));
      const el = h('div.field', [labelFor(def), select, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: (v) => { select.value = v; } };
    }

    case 'color': {
      values[name] = def.value ?? '#000000';
      const input = h('input', { type: 'color', value: values[name], oninput: (e) => set(e.target.value) });
      const el = h('div.field', [labelFor(def), input, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: (v) => { input.value = v; } };
    }

    case 'textarea': {
      values[name] = def.value ?? '';
      const input = h('textarea', { placeholder: def.placeholder || '', rows: def.rows || 5, oninput: (e) => set(e.target.value) });
      input.value = values[name];
      const el = h('div.field', [labelFor(def), input, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: (v) => { input.value = v; } };
    }

    case 'pages': {
      values[name] = def.value ?? 'all';
      const status = h('span.field__val', '');
      const input = h('input', { type: 'text', value: values[name], placeholder: def.placeholder || 'all', oninput: (e) => set(e.target.value) });
      const el = h('div.field', [
        labelFor(def, status), input,
        h('span.field__hint', def.hint || 'Examples: 1-4, 9, 12- · odd · even · last · -2 counts back from the end'),
      ]);
      return {
        def, el,
        apply: (v) => { input.value = v; },
        update: (vals, row) => {
          if (!def.check) return;
          const res = def.check(vals[name]);
          status.textContent = res.text;
          status.style.color = res.ok ? '' : 'var(--danger)';
          row.el.dataset.valid = String(res.ok);
        },
      };
    }

    case 'files': {
      values[name] = def.value ?? null;
      const input = h('input', { type: 'file', accept: def.accept || '', multiple: Boolean(def.multiple), onchange: (e) => set(def.multiple ? Array.from(e.target.files) : e.target.files[0] || null) });
      const el = h('div.field', [labelFor(def), input, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: () => {} };
    }

    case 'password':
    case 'text':
    default: {
      values[name] = def.value ?? '';
      const input = h('input', { type: def.type === 'password' ? 'password' : 'text', value: values[name], placeholder: def.placeholder || '', oninput: (e) => set(e.target.value) });
      const el = h('div.field', [labelFor(def), input, def.hint && h('span.field__hint', def.hint)]);
      return { def, el, apply: (v) => { input.value = v; } };
    }
  }
}

function formatValue(def, v) {
  if (def.format) return def.format(v);
  return `${v}${def.suffix || ''}`;
}

export function fieldGroup(children) { return h('div.grid-2', children); }
export { clear };
