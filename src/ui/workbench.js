import { h, clear, icon, bytes, plural, nextFrame } from './kit.js';
import { buildFields } from './fields.js';
import { toast, ok as toastOk, fail } from './toast.js';
import { download, downloadZip, toBlob, pickFiles, safeName } from '../core/files.js';
import { openViewer, thumbnail } from '../core/pdf.js';
import { noteJob } from '../core/monitor.js';

/**
 * The shared workbench.
 *
 * Every tool is the same shape: a stage on the left holding the document, a job
 * ticket on the right holding the settings, one button that runs the job. Tools
 * supply fields and a `run` function; anything visual beyond the default file
 * list is drawn by the tool into the stage element it is handed.
 */
export function workbench(host, tool, cfg) {
  const files = [];
  let fieldsApi = null;
  let busy = false;
  let outputs = [];

  const stageEl = h(`div.stage${cfg.plainStage ? '.stage--plain' : ''}`);
  const panelBody = h('div.panel__body');
  const progressBar = h('div.progress__bar');
  const progressEl = h('div.progress.progress--idle', progressBar);
  const runline = h('div.runline');
  const resultsEl = h('div.results');
  const runBtn = h('button.btn.btn--primary.btn--block.btn--lg', { type: 'button', disabled: true, onclick: () => start() },
    [icon(cfg.actionIcon || 'bolt', 17), cfg.action || 'Run']);

  const fileInput = h('input', {
    type: 'file', accept: cfg.accept || '', multiple: cfg.multiple !== false,
    onchange: (e) => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; },
  });

  const dropzone = h('div.drop', {
    role: 'button', tabindex: '0',
    onclick: () => fileInput.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } },
  }, [
    h('div.drop__ico', icon('upload', 34)),
    h('div.drop__title', cfg.dropTitle || (cfg.multiple === false ? 'Choose a file or drop it here' : 'Choose files or drop them here')),
    h('div.drop__hint', cfg.dropHint || 'Nothing is uploaded — the file is read by this tab only'),
    fileInput,
  ]);

  /* Drag and drop over the whole stage, not just the dashed box. */
  let dragDepth = 0;
  const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  stageEl.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth++; dropzone.classList.add('is-over'); });
  stageEl.addEventListener('dragover', (e) => { if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  stageEl.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropzone.classList.remove('is-over'); } });
  stageEl.addEventListener('drop', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault(); dragDepth = 0; dropzone.classList.remove('is-over');
    addFiles(Array.from(e.dataTransfer.files || []));
  });

  /* ---- API handed to the tool ---------------------------------------- */
  const api = {
    tool,
    files,
    get values() { return fieldsApi?.values || {}; },
    fields: () => fieldsApi,
    stageEl,
    panelBody,
    setField: (k, v) => fieldsApi?.set(k, v),
    refreshFields: () => fieldsApi?.refresh(),
    renderStage: () => renderStage(),
    addFiles,
    removeFile,
    clearFiles,
    status(text) { runline.textContent = text || ''; },
    progress(fraction, text) {
      progressEl.classList.remove('progress--idle');
      progressBar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
      if (text) runline.textContent = text;
      return nextFrame();
    },
    setRunLabel(text) { runBtn.lastChild.textContent = text; },
    enableRun(on) { runBtn.disabled = !on; },
    toast,
    done,
    /** For tools that produce their own single blob without going through done(). */
    save(data, name, type) { download(data, name, type); },
  };

  /* ---- Files ---------------------------------------------------------- */
  function accepted(file) {
    if (!cfg.accept) return true;
    const patterns = cfg.accept.split(',').map((s) => s.trim().toLowerCase());
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    return patterns.some((p) => (p.startsWith('.') ? name.endsWith(p) : p.endsWith('/*') ? type.startsWith(p.slice(0, -1)) : type === p));
  }

  async function addFiles(list) {
    const good = list.filter(accepted);
    const rejected = list.length - good.length;
    if (rejected) toast(`Skipped ${plural(rejected, 'file')} of the wrong type.`, 'error');
    if (!good.length) return;

    if (cfg.multiple === false) { files.length = 0; files.push(good[0]); }
    else files.push(...good);
    if (cfg.max && files.length > cfg.max) { files.length = cfg.max; toast(`This tool takes at most ${cfg.max} files.`); }

    outputs = [];
    renderResults();
    await afterFiles();
  }

  function removeFile(index) { files.splice(index, 1); afterFiles(); }
  function clearFiles() { files.length = 0; outputs = []; renderResults(); afterFiles(); }

  async function afterFiles() {
    renderStage();
    try { await cfg.onFiles?.(api); } catch (err) { fail(errorText(err)); }
    fieldsApi?.refresh();
    updateRunState();
  }

  function updateRunState() {
    const enough = cfg.noFiles ? true : files.length >= (cfg.min || 1);
    runBtn.disabled = busy || !enough || (cfg.canRun ? !cfg.canRun(api) : false);
  }

  /* ---- Stage ---------------------------------------------------------- */
  function renderStage() {
    clear(stageEl);
    if (!files.length && !cfg.noFiles) { stageEl.append(dropzone); return; }
    if (cfg.stage) { cfg.stage(api, stageEl); return; }
    stageEl.append(defaultToolbar(), fileList());
  }

  function defaultToolbar() {
    return h('div.stage__toolbar', [
      cfg.multiple !== false && h('button.btn.btn--sm', { type: 'button', onclick: () => fileInput.click() }, [icon('plus', 14), 'Add files']),
      cfg.multiple === false && h('button.btn.btn--sm', { type: 'button', onclick: () => fileInput.click() }, [icon('reset', 14), 'Replace file']),
      h('span.spacer'),
      h('span.stage__hint', files.length > 1 ? 'Drag to set the order' : ''),
      h('button.btn.btn--sm.btn--danger', { type: 'button', onclick: clearFiles }, [icon('trash', 14), 'Clear']),
      fileInput,
    ]);
  }

  function fileList() {
    const list = h('div.files');
    let dragIndex = null;

    files.forEach((file, i) => {
      const thumb = h('img.file__thumb', { alt: '', loading: 'lazy' });
      if (file.type === 'application/pdf') queueThumb(file, thumb);
      else if (file.type.startsWith('image/')) thumb.src = URL.createObjectURL(file);

      const row = h('div.file', { draggable: cfg.multiple !== false, dataset: { index: i } }, [
        cfg.multiple !== false && h('span.file__grip', { title: 'Drag to reorder' }, icon('grip', 14)),
        h('span.file__idx', String(i + 1)),
        thumb,
        h('div.file__meta', [
          h('div.file__name', { title: file.name }, file.name),
          h('div.file__sub', [bytes(file.size), file.__pages ? ` · ${plural(file.__pages, 'page')}` : '']),
        ]),
        h('div.file__act', [
          i > 0 && cfg.multiple !== false && h('button.btn.btn--ghost.btn--icon.btn--sm', { type: 'button', title: 'Move up', onclick: () => { swap(i, i - 1); } }, icon('chevL', 13, { width: 1.8 })),
          h('button.btn.btn--ghost.btn--icon.btn--sm', { type: 'button', title: 'Remove', onclick: () => removeFile(i) }, icon('x', 14)),
        ]),
      ]);

      row.addEventListener('dragstart', (e) => { dragIndex = i; row.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      row.addEventListener('dragend', () => { row.classList.remove('is-dragging'); });
      row.addEventListener('dragover', (e) => { if (dragIndex === null) return; e.preventDefault(); row.classList.add('is-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('is-target'));
      row.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        row.classList.remove('is-target');
        if (dragIndex === null || dragIndex === i) return;
        const [moved] = files.splice(dragIndex, 1);
        files.splice(i, 0, moved);
        dragIndex = null;
        afterFiles();
      });
      list.append(row);
    });
    return list;

    function swap(a, b) { [files[a], files[b]] = [files[b], files[a]]; afterFiles(); }
  }

  const thumbQueue = [];
  let thumbRunning = false;
  function queueThumb(file, img) {
    thumbQueue.push([file, img]);
    if (thumbRunning) return;
    thumbRunning = true;
    (async () => {
      while (thumbQueue.length) {
        const [f, el] = thumbQueue.shift();
        try {
          const doc = await openViewer(f, { noPrompt: true });
          f.__pages = doc.numPages;
          el.src = await thumbnail(doc, 1, 90);
          doc.destroy();
        } catch { el.replaceWith(h('span.file__thumb', { style: { display: 'grid', placeItems: 'center', color: 'var(--text-3)' } }, icon('protect', 14))); }
      }
      thumbRunning = false;
      renderFileSubtitles();
    })();
  }

  function renderFileSubtitles() {
    stageEl.querySelectorAll('.file').forEach((row, i) => {
      const f = files[i];
      if (!f?.__pages) return;
      const sub = row.querySelector('.file__sub');
      if (sub) sub.textContent = `${bytes(f.size)} · ${plural(f.__pages, 'page')}`;
    });
  }

  /* ---- Running -------------------------------------------------------- */
  async function start() {
    if (busy) return;
    const problem = cfg.validate?.(api);
    if (problem) { fail(problem); return; }

    busy = true;
    outputs = [];
    renderResults();
    runBtn.disabled = true;
    runBtn.lastChild.textContent = 'Working…';
    progressEl.classList.remove('progress--idle');
    progressBar.style.width = '2%';
    api.status('Starting…');
    const t0 = performance.now();

    try {
      await nextFrame();
      await cfg.run(api);
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      api.status(outputs.length ? `Finished in ${secs}s` : `Done in ${secs}s`);
      progressBar.style.width = '100%';
    } catch (err) {
      console.error(err);
      fail(errorText(err));
      api.status('Stopped — nothing was written.');
      progressEl.classList.add('progress--idle');
    } finally {
      busy = false;
      runBtn.lastChild.textContent = cfg.action || 'Run';
      updateRunState();
    }
  }

  /**
   * Deliver results: one file downloads directly, several are zipped unless the
   * tool asks otherwise. Cards stay on screen so they can be saved again.
   */
  async function done(list, opts = {}) {
    const items = (Array.isArray(list) ? list : [list]).filter(Boolean).map((item) => ({
      name: item.name,
      blob: toBlob(item.blob || item.data, item.type),
      note: item.note,
    }));
    outputs = items;
    renderResults();
    if (opts.autoSave === false) { noteJob(); return items; }

    if (items.length === 1) download(items[0].blob, items[0].name);
    else if (items.length > 1) {
      if (opts.zip === false) items.forEach((it, i) => setTimeout(() => download(it.blob, it.name), i * 120));
      else await downloadZip(items, opts.zipName || `${safeName(tool.id)}.zip`);
    }
    toastOk(items.length === 1 ? `Saved ${items[0].name}` : `Saved ${plural(items.length, 'file')}`);
    return items;
  }

  function renderResults() {
    clear(resultsEl);
    if (!outputs.length) return;
    if (outputs.length > 1) {
      resultsEl.append(h('button.btn.btn--sm.btn--block', { type: 'button', onclick: () => downloadZip(outputs, `${safeName(tool.id)}.zip`) }, [icon('zip', 14), `Save all ${outputs.length} again (.zip)`]));
    }
    outputs.slice(0, 24).forEach((item) => {
      resultsEl.append(h('div.result', [
        h('span.result__ico', icon('check', 16, { width: 2 })),
        h('div.result__meta', [
          h('div.result__name', { title: item.name }, item.name),
          h('div.result__sub', [bytes(item.blob.size), item.note ? ` · ${item.note}` : '']),
        ]),
        h('button.btn.btn--ghost.btn--icon.btn--sm', { type: 'button', title: 'Save again', onclick: () => download(item.blob, item.name) }, icon('download', 15)),
      ]));
    });
    if (outputs.length > 24) resultsEl.append(h('div.runline', `+ ${outputs.length - 24} more in the archive`));
  }

  /* ---- Assemble -------------------------------------------------------- */
  const panel = h('aside.panel', [
    h('div.panel__head', [
      h('span.eyebrow', cfg.panelTitle || 'Job ticket'),
      h('button.btn.btn--ghost.btn--sm', { type: 'button', title: 'Start over', onclick: () => { clearFiles(); host.dispatchEvent(new CustomEvent('quire:reset')); } }, [icon('reset', 13), 'Reset']),
    ]),
    panelBody,
    h('div.panel__foot', [progressEl, runline, runBtn, resultsEl]),
  ]);

  const section = h('section.wb.wrap', [
    h('nav.wb__crumbs', { 'aria-label': 'Breadcrumb' }, [h('a', { href: '#/' }, 'Tools'), '/', h('span', tool.category), '/', h('span', { style: { color: 'var(--text-2)' } }, tool.name)]),
    h('header.wb__head', [
      h('span.wb__ico', { style: { '--card-ink': tool.ink } }, icon(tool.icon, 22)),
      h('div', [h('h1.wb__title', tool.name), h('p.wb__sub', cfg.blurb || tool.long || tool.desc)]),
    ]),
    h('div.wb__cols', [stageEl, panel]),
  ]);
  section.style.setProperty('--card-ink', tool.ink);
  host.append(section);

  const defs = typeof cfg.fields === 'function' ? cfg.fields(api) : (cfg.fields || []);
  fieldsApi = buildFields(panelBody, defs, (values, name) => {
    cfg.onFieldChange?.(api, name, values);
    updateRunState();
  });

  renderStage();
  updateRunState();

  /* Ctrl/Cmd+Enter runs the job from anywhere on the page. */
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !runBtn.disabled) { e.preventDefault(); start(); } };
  document.addEventListener('keydown', onKey);
  host.addEventListener('quire:teardown', () => document.removeEventListener('keydown', onKey), { once: true });

  api.start = start;
  api.pickFiles = async () => addFiles(await pickFiles({ accept: cfg.accept, multiple: cfg.multiple !== false }));
  return api;
}

export function errorText(err) {
  const msg = err?.message || String(err);
  if (/password/i.test(msg) && /cancel/i.test(msg)) return 'Cancelled — no password given.';
  if (/encrypted/i.test(msg)) return 'This file is encrypted. Open it with Remove password first.';
  if (/Invalid PDF structure|No PDF header|FormatError/i.test(msg)) return 'That file is not a readable PDF. Try Repair PDF.';
  if (/out of memory|Array buffer allocation/i.test(msg)) return 'The browser ran out of memory. Try fewer pages or a lower resolution.';
  return msg;
}
