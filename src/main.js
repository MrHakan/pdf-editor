import { installMonitor, onChange as onMeterChange } from './core/monitor.js';
installMonitor(); // before anything else can make a request

import { h, clear, icon, bytes, plural, debounce } from './ui/kit.js';
import { TOOLS, CATEGORIES, byId, searchTools } from './tools/registry.js';
import { errorText } from './ui/workbench.js';
import { fail } from './ui/toast.js';

const view = document.getElementById('view');

/* ---- Theme ------------------------------------------------------------- */
const THEME_KEY = 'quire.theme';
function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem(THEME_KEY, name); } catch { /* ignore */ }
}
(function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  applyTheme(saved || (matchMedia('(prefers-color-scheme: light)').matches ? 'stock' : 'press'));
})();
document.getElementById('btn-theme').addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'press' ? 'stock' : 'press');
});

/* ---- Router ------------------------------------------------------------ */
const routes = {
  '': renderHome,
  'tools': renderHome,
  'privacy': renderPrivacy,
  'about': renderAbout,
};

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [head, param] = hash.split('/');

  view.dispatchEvent(new CustomEvent('quire:teardown'));
  clear(view);

  if (head === 't' && param) return renderTool(param);
  const fn = routes[head];
  if (fn) return fn();
  return renderMissing(hash);
}

window.addEventListener('hashchange', () => { route(); view.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); });

/* ---- Home -------------------------------------------------------------- */
function renderHome() {
  document.title = 'Quire — PDF workshop that runs on your device';

  const meter = buildMeter();

  view.append(
    h('section.hero', h('div.wrap.hero__in', [
      h('div', [
        h('p.eyebrow', `${TOOLS.length} tools · no upload · no account`),
        h('h1', ['Your documents stay ', h('em', 'on this machine'), '.']),
        h('p.hero__lede', 'Merge, split, sign, redact, compress and convert PDFs in the browser you already have open. Quire has no server to send a file to — the work happens between your keyboard and your disk.'),
        h('div.hero__cta', [
          h('button.btn.btn--primary.btn--lg', { type: 'button', onclick: () => gotoBoard(true) }, [icon('bolt', 17), 'Open the tool board']),
          h('a.btn.btn--lg', { href: '#/privacy' }, 'How that actually works'),
        ]),
      ]),
      meter.el,
    ])),

    h('section.assure', h('div.assure__in', [
      assurance('No server', 'There is nowhere to upload to', 'Quire is a folder of static files. No database, no API, no request log — a file you open is read by this tab and forgotten when you close it.'),
      assurance('Offline', 'It keeps working without a network', 'Everything the tools need is cached on first visit. Install it from your browser menu and the whole workshop runs on a plane.'),
      assurance('Open', 'You can check the wiring', 'The source is public and readable, and the transfer log above is measured by the page rather than promised by it.'),
    ])),

    buildBoard(),
  );
}

function assurance(eyebrow, title, text) {
  return h('div.assure__cell', [h('span.eyebrow', eyebrow), h('h3', title), h('p', text)]);
}

/* The transfer log — the page auditing its own network use. */
function buildMeter() {
  const sent = h('span.meter__v', { dataset: { state: 'zero' } }, '0 B');
  const off = h('span.meter__v', { dataset: { state: 'zero' } }, '0');
  const local = h('span.meter__v', '0 B');
  const foot = h('p.meter__foot');

  const el = h('div.meter.cropmarks', [
    h('div.meter__head', [
      h('span.meter__target', icon('target', 17)),
      h('span.meter__title', 'Transfer log · live'),
    ]),
    h('div.meter__row', [h('span.meter__k', 'Bytes sent to a server'), sent]),
    h('div.meter__row', [h('span.meter__k', 'Off-site requests'), off]),
    h('div.meter__row', [h('span.meter__k', 'Handled on this device'), local]),
    foot,
  ]);

  onMeterChange((s) => {
    sent.textContent = bytes(s.sentBytes);
    sent.dataset.state = s.sentBytes === 0 ? 'zero' : 'hot';
    off.textContent = String(s.offsite);
    off.dataset.state = s.offsite === 0 ? 'zero' : 'hot';
    local.textContent = bytes(s.localBytes);
    clear(foot).append(
      'Counted by this page, by wrapping every call it is able to make. ',
      s.lifetime.pages ? h('b', `${plural(s.lifetime.pages, 'page')} handled here so far.`) : 'Nothing has left yet.',
    );
  });

  return { el };
}

function buildBoard() {
  const search = h('input', { type: 'search', placeholder: 'Search tools — try "sign", "smaller", "password"', 'aria-label': 'Search tools', autocomplete: 'off' });
  const chips = h('div.chips', { role: 'group', 'aria-label': 'Filter by category' });
  const results = h('div');
  let activeCat = 'all';

  const chipButtons = [{ id: 'all', label: 'All' }, ...CATEGORIES].map((c) => {
    const b = h('button.chip', { type: 'button', 'aria-pressed': String(c.id === 'all'), onclick: () => { activeCat = c.id; chipButtons.forEach(({ b: x, c: y }) => x.setAttribute('aria-pressed', String(y.id === c.id))); paint(); } }, c.label);
    chips.append(b);
    return { b, c };
  });

  function paint() {
    const q = search.value;
    const found = searchTools(q);
    const list = activeCat === 'all' ? found : found.filter((t) => t.cat === activeCat);
    clear(results);

    if (!list.length) {
      results.append(h('div.empty', [h('p', ['Nothing matches ', h('code', q || activeCat), '.']), h('p.field__hint', 'Try a plainer word — the search looks at what each tool does, not just its name.')]));
      return;
    }

    const groups = q.trim()
      ? [{ label: `${plural(list.length, 'match', 'matches')}`, items: list }]
      : CATEGORIES.map((c) => ({ label: c.label, blurb: c.blurb, items: list.filter((t) => t.cat === c.id) })).filter((g) => g.items.length);

    let n = 0;
    for (const g of groups) {
      results.append(h('section.group', [
        h('div.group__head', [h('span.eyebrow', g.label), h('span.group__rule'), h('span.group__count', g.blurb || plural(g.items.length, 'tool'))]),
        h('div.grid', g.items.map((t) => toolCard(t, n++))),
      ]));
    }
  }

  search.addEventListener('input', debounce(paint, 90));
  search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { search.value = ''; paint(); } });
  boardSearch = search;
  document.getElementById('btn-search').onclick = () => gotoBoard(true);

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) {
      if (!search.isConnected) return;
      e.preventDefault(); search.focus(); search.select();
    }
  });

  paint();

  return h('section.board#tools', h('div.wrap', [
    h('div.board__bar', [
      h('div.searchbox', [icon('search', 15, { width: 1.7 }), search, h('kbd', '/')]),
      chips,
    ]),
    results,
  ]));
}

/** The board lives on the home page, so reach it by scrolling, not by routing. */
let boardSearch = null;
function gotoBoard(focus = false) {
  if (!document.getElementById('tools')) { location.hash = '#/'; setTimeout(() => gotoBoard(focus), 60); return; }
  document.getElementById('tools').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (focus) setTimeout(() => boardSearch?.focus(), 260);
}

function toolCard(t, i) {
  return h('a.card.cropmarks', { href: `#/t/${t.id}`, style: { '--card-ink': t.ink, '--i': i } }, [
    h('span.card__ico', icon(t.icon, 18)),
    t.badge && h('span.card__tag', t.badge),
    h('span.card__name', t.name),
    h('span.card__desc', t.desc),
  ]);
}

/* ---- Tool -------------------------------------------------------------- */
async function renderTool(id) {
  const tool = byId(id);
  if (!tool) return renderMissing(`t/${id}`);
  document.title = `${tool.name} — Quire`;

  view.append(h('div.wrap.loading', [h('span.spinner'), `Loading ${tool.name.toLowerCase()}…`]));
  try {
    const mod = await tool.load();
    clear(view);
    (mod.default || mod.mount)(view, tool);
  } catch (err) {
    console.error(err);
    clear(view);
    view.append(h('div.wrap.prose', [
      h('h1', 'That tool would not load'),
      h('p', errorText(err)),
      h('p', h('a.btn', { href: '#/' }, 'Back to the tool board')),
    ]));
    fail('The tool failed to load. A reload usually fixes it.');
  }
}

/* ---- Static pages ------------------------------------------------------ */
function renderPrivacy() {
  document.title = 'How Quire stays local';
  view.append(h('div.wrap.prose', { html: `
    <h1>How this stays local</h1>
    <p>Quire is a static website: a handful of HTML, CSS, JavaScript and font files. There is no backend behind it, so there is no endpoint that could receive a document even if the code tried to send one.</p>

    <h2>What happens when you open a file</h2>
    <p>The file picker and drag-and-drop hand the page a <code>File</code> object — a reference to bytes on your disk. Quire reads those bytes into memory, works on them, and hands the result back to your browser's download machinery. The bytes never touch a network interface.</p>

    <h2>The transfer log</h2>
    <p>The counter on the home page is not decoration. At startup, before any other code runs, Quire replaces <code>fetch</code>, <code>XMLHttpRequest</code>, <code>navigator.sendBeacon</code> and <code>WebSocket</code> with wrappers that measure every call and every request body. If a future change to this app ever tried to phone home, that number would stop being zero and the page would say so.</p>
    <p>You do not have to take the page's word for it either: open your browser's network panel, run any tool, and watch the request list stay empty.</p>

    <h2>What is fetched, and when</h2>
    <ul>
      <li><strong>On first load:</strong> the page, its stylesheet, two interface fonts, and the small script that draws the tool board.</li>
      <li><strong>When you open a tool:</strong> that tool's module, plus the PDF engine the first time it is needed.</li>
      <li><strong>When you embed text in a non-Latin script:</strong> one font file, from this same site.</li>
    </ul>
    <p>All of it is served from this origin. There is no CDN, no font service, no analytics script, no error reporter and no cookie.</p>

    <h2>What is stored on your device</h2>
    <table>
      <tr><th>Key</th><th>Holds</th></tr>
      <tr><td><code>quire.theme</code></td><td>Whether you chose the light or dark interface.</td></tr>
      <tr><td><code>quire.lifetime</code></td><td>A count of pages and jobs, purely so the meter has something to show. No file names.</td></tr>
      <tr><td>Cache storage</td><td>The app's own files, so it opens offline.</td></tr>
    </table>
    <p>Clearing site data in your browser removes all three. Documents are never written to storage — close the tab and they are gone from memory.</p>

    <h2>The limits worth knowing</h2>
    <ul>
      <li>Everything runs in one tab, so very large documents are bound by the memory your browser will give a page. A few hundred megabytes is usually fine; a few gigabytes is not.</li>
      <li><strong>Redaction rebuilds pages as images</strong> so the covered text is genuinely destroyed. Always open the result and check it before sending it on.</li>
      <li>Removing a password needs the password. Nothing here can open a document you cannot already open.</li>
    </ul>
  ` }));
}

function renderAbout() {
  document.title = 'About Quire';
  view.append(h('div.wrap.prose', { html: `
    <h1>About</h1>
    <p>A quire is a stack of folded sheets — the unit a book is actually built from. This one is a workshop for the digital equivalent: ${TOOLS.length} tools that merge, split, sign, redact, compress, convert and inspect PDFs, all of them running inside your browser.</p>

    <h2>Why it exists</h2>
    <p>Most PDF tools on the web ask you to upload a contract, a passport scan or a payslip to a machine you know nothing about, and then trust a sentence about deletion. Browsers have been able to do this work locally for years. This is that, built properly.</p>

    <h2>What it is made of</h2>
    <ul>
      <li><strong>pdf-lib</strong> writes and edits documents.</li>
      <li><strong>PDF.js</strong> renders and reads them.</li>
      <li><strong>JSZip</strong> bundles multi-file results.</li>
      <li><strong>Noto</strong> covers text in scripts the built-in PDF fonts cannot reach.</li>
      <li>Everything else is plain JavaScript — no framework, no build step, no bundler.</li>
    </ul>

    <h2>Keyboard</h2>
    <table>
      <tr><th>Key</th><th>Does</th></tr>
      <tr><td><code>/</code></td><td>Jump to the tool search</td></tr>
      <tr><td><code>Ctrl</code> / <code>⌘</code> + <code>Enter</code></td><td>Run the tool you are on</td></tr>
      <tr><td><code>Esc</code></td><td>Close a dialog, clear the search</td></tr>
      <tr><td><code>Shift</code> / <code>Ctrl</code> + click</td><td>Select a run of pages, or add one</td></tr>
    </table>

    <h2>Reporting something</h2>
    <p>If a document comes out wrong, the file itself is usually the clue. Issues and patches are welcome on <a href="https://github.com/MrHakan/pdf-editor" target="_blank" rel="noopener">GitHub</a> — please don't attach anything confidential.</p>
  ` }));
}

function renderMissing(hash) {
  document.title = 'Not found — Quire';
  view.append(h('div.wrap.prose', [
    h('h1', 'No such page'),
    h('p', [h('code', `#/${hash}`), ' does not match any tool here.']),
    h('p', h('a.btn.btn--primary', { href: '#/' }, 'Back to the tool board')),
  ]));
}

/* ---- Boot -------------------------------------------------------------- */
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { scope: './' }).catch(() => { /* offline support is optional */ });
  });
}
