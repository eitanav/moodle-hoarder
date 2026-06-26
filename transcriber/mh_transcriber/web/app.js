/* Moodle Hoarder Transcriber — web UI logic.
   Talks to the local server API, renders warehouses/files, streams live
   transcription progress over SSE, and persists settings. */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let state = null;
let selectedId = null;
let contentShape = '';
let dragging = false;

const STATUS_LABEL = {
  queued: 'בתור',
  running: 'מתמלל',
  done: 'הושלם',
  error: 'שגיאה',
  stopped: 'בוטל',
  missing: 'חסר',
};

// --------------------------------------------------------------------------
// utilities
// --------------------------------------------------------------------------
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function selectedWarehouse() {
  return state ? state.warehouses.find((w) => w.id === selectedId) || null : null;
}

function effectiveDir(wh) {
  const base = (wh.output_dir || state.settings.output_dir || state.meta.default_output_dir || '').replace(/[\\/]+$/, '');
  return base ? `${base} / ${wh.name}` : `(ליד קובץ המקור) / ${wh.name}`;
}

function warehouseDotClass(wh) {
  if (state.active_warehouse_id === wh.id) return 'dot run';
  if (wh.files.some((f) => f.status === 'error' || f.status === 'missing')) return 'dot err';
  if (wh.files.length && wh.files.every((f) => f.status === 'done')) return 'dot done';
  return 'dot';
}

// --------------------------------------------------------------------------
// theme
// --------------------------------------------------------------------------
function applyTheme(theme, accent) {
  const root = document.documentElement;
  root.classList.remove('mh-theme-dark', 'mh-theme-light');
  if (theme === 'dark') root.classList.add('mh-theme-dark');
  else if (theme === 'light') root.classList.add('mh-theme-light');
  root.classList.toggle('mh-accent-blue', accent === 'blue');
  try {
    localStorage.setItem('mh-tr-theme', theme);
    localStorage.setItem('mh-tr-accent', accent);
  } catch (e) { /* ignore */ }
}

async function setSetting(patch) {
  // Optimistic theme apply for snappy feedback.
  if (patch.theme || patch.accent) {
    applyTheme(patch.theme || state.settings.theme, patch.accent || state.settings.accent);
  }
  Object.assign(state.settings, patch);
  await api('POST', '/api/settings', patch);
}

// --------------------------------------------------------------------------
// rendering
// --------------------------------------------------------------------------
function render() {
  if (!state) return;
  applyTheme(state.settings.theme, state.settings.accent);
  if (!state.warehouses.some((w) => w.id === selectedId)) {
    selectedId = state.warehouses.length ? state.warehouses[0].id : null;
  }
  renderSidebar();
  renderContent();
}

function renderSidebar() {
  const list = $('#warehouse-list');
  const scroll = list.scrollTop;
  if (!state.warehouses.length) {
    list.innerHTML = '<li class="empty-hint">אין מחסנים עדיין.<br>צור מחסן חדש כדי להתחיל.</li>';
    return;
  }
  list.innerHTML = state.warehouses.map((wh) => {
    const total = wh.files.length;
    const done = wh.files.filter((f) => f.status === 'done').length;
    return `
      <li class="warehouse-item ${wh.id === selectedId ? 'active' : ''}" data-id="${wh.id}">
        <div class="wname"><span class="${warehouseDotClass(wh)}"></span>${esc(wh.name)}</div>
        <div class="wmeta">${total} קבצים${total ? ` · ${done} הושלמו` : ''}</div>
      </li>`;
  }).join('');
  list.scrollTop = scroll;
  $$('.warehouse-item', list).forEach((el) => {
    el.addEventListener('click', () => { selectedId = el.dataset.id; render(); });
  });
}

function contentShapeKey() {
  const wh = selectedWarehouse();
  if (!wh) return 'none';
  return `${wh.id}|${wh.files.map((f) => f.id).join(',')}`;
}

function renderContent() {
  const root = $('#content');
  const wh = selectedWarehouse();
  if (!wh) {
    contentShape = 'none';
    root.innerHTML = `
      <div class="empty-hint" style="margin-top:60px">
        <div style="font-size:42px;margin-bottom:10px">🗂️</div>
        <div>צור מחסן ראשון כדי להעלות אליו קבצים ולתמלל אותם ברצף.</div>
        <div style="margin-top:16px"><button class="btn btn-primary" id="btn-first-wh">+ צור מחסן</button></div>
      </div>`;
    $('#btn-first-wh').addEventListener('click', createWarehouse);
    return;
  }

  const shape = contentShapeKey();
  if (shape === contentShape && root.dataset.built === '1') {
    updateDynamic();
    return;
  }
  contentShape = shape;

  root.innerHTML = `
    <div class="content-head">
      <div class="wtitle">
        <h2 id="wh-name">${esc(wh.name)}</h2>
        <div class="outline">פלט: <span id="wh-dir">${esc(effectiveDir(wh))}</span>
          · <a id="wh-open">פתח תיקייה</a> · <a id="wh-setdir">שנה</a> · <a id="wh-rename">שנה שם</a></div>
      </div>
      <button class="btn btn-sm btn-danger" id="wh-delete">מחק מחסן</button>
    </div>

    <div class="dropzone" id="dropzone">
      <div class="big">⬆️</div>
      <div><strong>גרור קבצים לכאן</strong> או לחץ לבחירה</div>
      <div class="small">MP4 · MP3 · M4A · WAV · WEBM · MOV · MKV ועוד</div>
    </div>

    <div class="section-title">קבצים בתור</div>
    <ul class="files" id="files"></ul>

    <div class="queuebar">
      <div class="qinfo" id="qinfo"></div>
      <button class="btn btn-primary" id="btn-start">▶ התחל תמלול ברצף</button>
      <button class="btn btn-danger" id="btn-stop">■ עצור</button>
    </div>

    <div class="log-wrap">
      <div class="section-title">לוג</div>
      <div class="log" id="log"></div>
    </div>`;
  root.dataset.built = '1';

  buildFileRows(wh);
  wireContent(wh);
  updateDynamic();
}

function buildFileRows(wh) {
  const ul = $('#files');
  if (!wh.files.length) {
    ul.innerHTML = '<li class="empty-hint" style="padding:18px">אין קבצים עדיין — גרור קבצים למעלה.</li>';
    return;
  }
  ul.innerHTML = wh.files.map((f) => `
    <li class="file" data-id="${f.id}">
      <div class="top">
        <span class="fname" title="${esc(f.name)}">${esc(f.name)}</span>
        <span class="fsize">${fmtSize(f.size)}</span>
        <span class="badge ${f.status}" data-role="badge">${STATUS_LABEL[f.status] || f.status}</span>
      </div>
      <div class="progress"><span data-role="bar"></span></div>
      <div class="fmsg" data-role="msg"></div>
      <div class="file-actions" data-role="actions"></div>
    </li>`).join('');
}

function updateDynamic() {
  const wh = selectedWarehouse();
  if (!wh) return;

  wh.files.forEach((f) => {
    const li = document.querySelector(`#files .file[data-id="${f.id}"]`);
    if (!li) return;
    const badge = $('[data-role="badge"]', li);
    badge.className = `badge ${f.status}`;
    badge.textContent = STATUS_LABEL[f.status] || f.status;
    $('[data-role="bar"]', li).style.width = `${Math.max(0, Math.min(100, f.progress || 0))}%`;
    const msg = $('[data-role="msg"]', li);
    msg.textContent = f.status === 'error' ? (f.error || f.message) : f.message;
    msg.classList.toggle('err', f.status === 'error' || f.status === 'missing');

    const actions = $('[data-role="actions"]', li);
    const buttons = [];
    if (f.status === 'done' && f.outputs) {
      for (const [fmt, path] of Object.entries(f.outputs)) {
        buttons.push(`<a class="btn btn-sm" href="/api/download?path=${encodeURIComponent(path)}">${fmt.toUpperCase()} ⬇</a>`);
      }
    }
    if (f.status !== 'running') {
      buttons.push(`<button class="btn btn-sm btn-ghost" data-del="${f.id}">הסר</button>`);
    }
    actions.innerHTML = buttons.join('');
    $$('[data-del]', actions).forEach((b) =>
      b.addEventListener('click', () => deleteFile(wh.id, b.dataset.del)));
  });

  // queue bar
  const running = state.active_warehouse_id === wh.id;
  const total = wh.files.length;
  const done = wh.files.filter((f) => f.status === 'done').length;
  const pending = wh.files.filter((f) => ['queued', 'error', 'stopped'].includes(f.status)).length;
  const qinfo = $('#qinfo');
  if (qinfo) {
    if (running) qinfo.textContent = `מתמלל… ${done}/${total} הושלמו`;
    else if (state.running) qinfo.textContent = 'מחסן אחר מתמלל כרגע…';
    else qinfo.textContent = total ? `${pending} בהמתנה · ${done} הושלמו` : 'אין קבצים';
  }
  const startBtn = $('#btn-start');
  const stopBtn = $('#btn-stop');
  if (startBtn) startBtn.disabled = state.running || pending === 0;
  if (stopBtn) { stopBtn.disabled = !running; stopBtn.style.display = running ? '' : 'none'; }

  // header dir (may change if settings/override changed)
  const dir = $('#wh-dir');
  if (dir) dir.textContent = effectiveDir(wh);

  // log
  const log = $('#log');
  if (log) {
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
    const text = (state.log || []).join('\n');
    if (log.textContent !== text) {
      log.textContent = text;
      if (atBottom) log.scrollTop = log.scrollHeight;
    }
  }
}

function wireContent(wh) {
  $('#wh-delete').addEventListener('click', () => deleteWarehouse(wh.id, wh.name));
  $('#wh-rename').addEventListener('click', () => renameWarehouse(wh));
  $('#wh-setdir').addEventListener('click', () => setWarehouseDir(wh));
  $('#wh-open').addEventListener('click', async () => {
    const base = wh.output_dir || state.settings.output_dir || state.meta.default_output_dir;
    await api('POST', '/api/open-folder', { path: base });
  });

  const dz = $('#dropzone');
  dz.addEventListener('click', () => $('#file-input').click());
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dragging = true; dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => { dragging = false; dz.classList.remove('drag'); });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dragging = false;
    dz.classList.remove('drag');
    if (e.dataTransfer && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  $('#btn-start').addEventListener('click', () => startWarehouse(wh.id));
  $('#btn-stop').addEventListener('click', stopQueue);
}

// --------------------------------------------------------------------------
// actions
// --------------------------------------------------------------------------
async function createWarehouse() {
  const name = (prompt('שם המחסן החדש:', `מחסן ${(state ? state.warehouses.length : 0) + 1}`) || '').trim();
  if (name === null) return;
  const { data } = await api('POST', '/api/warehouses', { name });
  if (data.warehouse) selectedId = data.warehouse.id;
}

async function deleteWarehouse(id, name) {
  if (!confirm(`למחוק את המחסן "${name}"? הקבצים שהועלו יימחקו (התמלולים שכבר נוצרו יישארו).`)) return;
  const { ok, data } = await api('DELETE', `/api/warehouses/${id}`);
  if (!ok) toast(data.error || 'מחיקה נכשלה');
}

async function renameWarehouse(wh) {
  const name = (prompt('שם חדש למחסן:', wh.name) || '').trim();
  if (!name) return;
  await api('POST', `/api/warehouses/${wh.id}/rename`, { name });
}

async function setWarehouseDir(wh) {
  const { data } = await api('POST', '/api/pick-folder', { initial: wh.output_dir || state.settings.output_dir });
  if (data.ok && data.path) {
    await api('POST', `/api/warehouses/${wh.id}/rename`, { output_dir: data.path });
    toast('תיקיית הפלט של המחסן עודכנה');
  } else if (data.error) {
    const manual = prompt('הזן נתיב תיקיית פלט למחסן הזה (ריק = השתמש בברירת המחדל):', wh.output_dir || '');
    if (manual !== null) await api('POST', `/api/warehouses/${wh.id}/rename`, { output_dir: manual.trim() });
  }
}

async function deleteFile(whId, fileId) {
  const { ok, data } = await api('DELETE', `/api/warehouses/${whId}/files/${fileId}`);
  if (!ok) toast(data.error || 'הסרה נכשלה');
}

async function uploadFiles(fileList) {
  const wh = selectedWarehouse();
  if (!wh) return;
  let okCount = 0;
  for (const file of fileList) {
    try {
      const res = await fetch(`/api/warehouses/${wh.id}/files`, {
        method: 'POST',
        headers: { 'X-Filename': encodeURIComponent(file.name) },
        body: file,
      });
      if (res.ok) okCount++;
      else toast(`העלאת ${file.name} נכשלה`);
    } catch (e) {
      toast(`העלאת ${file.name} נכשלה`);
    }
  }
  if (okCount) toast(`נוספו ${okCount} קבצים`);
}

async function startWarehouse(id) {
  const { ok, data } = await api('POST', `/api/warehouses/${id}/start`);
  if (!ok) toast(data.message || data.error || 'לא ניתן להתחיל');
}

async function stopQueue() {
  await api('POST', '/api/stop');
}

// --------------------------------------------------------------------------
// settings modal
// --------------------------------------------------------------------------
function openSettings() {
  const s = state.settings;
  const m = state.meta;
  $('#set-output-dir').value = s.output_dir || '';
  $('#set-language').value = s.language || '';
  $('#set-beam').value = s.beam_size || 5;
  $('#set-preprocess').checked = !!s.preprocess_audio;

  $('#set-model').innerHTML = m.models.map((x) => `<option ${x === s.model ? 'selected' : ''}>${x}</option>`).join('');
  $('#set-device').innerHTML = m.devices.map((x) => `<option ${x === s.device ? 'selected' : ''}>${x}</option>`).join('');
  $('#set-compute').innerHTML = m.compute_types.map((x) => `<option ${x === s.compute_type ? 'selected' : ''}>${x}</option>`).join('');

  $('#set-formats').innerHTML = m.formats.map((f) =>
    `<span class="chip ${s.formats.includes(f) ? 'on' : ''}" data-fmt="${f}">${f.toUpperCase()}</span>`).join('');
  $$('#set-formats .chip').forEach((c) =>
    c.addEventListener('click', () => c.classList.toggle('on')));

  syncSegmented('#set-theme', s.theme);
  syncSegmented('#set-accent', s.accent);

  $('#settings-modal').classList.add('show');
}

function syncSegmented(sel, value) {
  $$(`${sel} button`).forEach((b) => b.classList.toggle('active', b.dataset.v === value));
}

function closeSettings() { $('#settings-modal').classList.remove('show'); }

async function saveSettings() {
  const formats = $$('#set-formats .chip.on').map((c) => c.dataset.fmt);
  const patch = {
    output_dir: $('#set-output-dir').value.trim(),
    language: $('#set-language').value.trim(),
    beam_size: parseInt($('#set-beam').value, 10) || 5,
    preprocess_audio: $('#set-preprocess').checked,
    model: $('#set-model').value,
    device: $('#set-device').value,
    compute_type: $('#set-compute').value,
    formats,
  };
  await api('POST', '/api/settings', patch);
  Object.assign(state.settings, patch);
  closeSettings();
  toast('ההגדרות נשמרו');
}

// --------------------------------------------------------------------------
// wiring (static elements)
// --------------------------------------------------------------------------
function wireStatic() {
  $('#btn-new-warehouse').addEventListener('click', createWarehouse);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-close-settings').addEventListener('click', closeSettings);
  $('#btn-cancel-settings').addEventListener('click', closeSettings);
  $('#btn-save-settings').addEventListener('click', saveSettings);
  $('#settings-modal').addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') closeSettings();
  });

  $('#file-input').addEventListener('change', (e) => {
    if (e.target.files.length) uploadFiles(e.target.files);
    e.target.value = '';
  });

  $('#btn-theme').addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
    setSetting({ theme: next });
    toast(`מצב תצוגה: ${next === 'system' ? 'מערכת' : next === 'light' ? 'בהיר' : 'כהה'}`);
  });
  $('#btn-accent').addEventListener('click', () => {
    const next = state.settings.accent === 'blue' ? 'pink' : 'blue';
    setSetting({ accent: next });
  });

  // Settings segmented controls apply immediately (live preview).
  $$('#set-theme button').forEach((b) =>
    b.addEventListener('click', () => { setSetting({ theme: b.dataset.v }); syncSegmented('#set-theme', b.dataset.v); }));
  $$('#set-accent button').forEach((b) =>
    b.addEventListener('click', () => { setSetting({ accent: b.dataset.v }); syncSegmented('#set-accent', b.dataset.v); }));

  $('#set-pick-output').addEventListener('click', async () => {
    const { data } = await api('POST', '/api/pick-folder', { initial: $('#set-output-dir').value });
    if (data.ok && data.path) $('#set-output-dir').value = data.path;
    else if (data.error) toast(data.error);
  });
  $('#set-open-output').addEventListener('click', () =>
    api('POST', '/api/open-folder', { path: $('#set-output-dir').value }));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });
}

// --------------------------------------------------------------------------
// boot
// --------------------------------------------------------------------------
function connectSSE() {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    try {
      state = JSON.parse(e.data);
      render();
    } catch (err) { /* ignore malformed */ }
  };
  es.onerror = () => { /* EventSource auto-reconnects */ };
}

async function boot() {
  wireStatic();
  try {
    const { data } = await api('GET', '/api/state');
    state = data;
    render();
  } catch (e) { /* SSE will populate */ }
  connectSSE();
}

boot();
