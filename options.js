// Options page logic. Binds form controls to chrome.storage via settings.js.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOWNLOAD_HISTORY_KEY = 'downloadHistory';

// Activity types shown in the file-type picker. Labels resolve through
// i18n at render time (key `ft.<type>`), so they re-translate on language
// switch like everything else.
const FILETYPE_KEYS = [
  'resource', 'folder', 'assign', 'url', 'page', 'book', 'quiz', 'lesson',
  'forum', 'chat', 'feedback', 'choice', 'wiki', 'glossary', 'workshop',
  'scorm', 'h5pactivity',
];

function flashSaved() {
  const el = $('#status');
  el.classList.add('show');
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(() => el.classList.remove('show'), 1200);
}

function bindToggle(input, key, settings) {
  input.checked = !!settings[key];
  input.addEventListener('change', async () => {
    await updateSetting(key, input.checked);
    flashSaved();
  });
}

function bindText(input, key, settings) {
  input.value = settings[key] ?? '';
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const v = input.type === 'number' ? (+input.value || 0) : input.value;
      await updateSetting(key, v);
      flashSaved();
    }, 350);
  });
}

function bindRadios(container, key, settings, onChange) {
  const value = settings[key];
  for (const label of container.querySelectorAll('label')) {
    const radio = label.querySelector('input[type="radio"]');
    if (radio.value === value) label.classList.add('active');
    radio.checked = radio.value === value;
    label.addEventListener('click', async (e) => {
      e.preventDefault();
      container.querySelectorAll('label').forEach(l => l.classList.remove('active'));
      label.classList.add('active');
      radio.checked = true;
      await updateSetting(key, radio.value);
      // Live side-effect (e.g. apply theme immediately) BEFORE flashSaved so
      // the toast doesn't appear on the still-old background.
      if (typeof onChange === 'function') onChange(radio.value);
      flashSaved();
    });
  }
}

function renderFileTypes(settings) {
  const wrap = $('#fileTypes');
  wrap.innerHTML = '';
  for (const type of FILETYPE_KEYS) {
    const enabled = settings.fileTypes[type] !== false;
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" ${enabled ? 'checked' : ''}> <span></span>`;
    lbl.querySelector('span').textContent = t(`ft.${type}`);
    const checkbox = lbl.querySelector('input');
    checkbox.addEventListener('change', async () => {
      const s = await getSettings();
      s.fileTypes = { ...s.fileTypes, [type]: checkbox.checked };
      await saveSettings(s);
      flashSaved();
    });
    wrap.appendChild(lbl);
  }
}

function formatBytes(n) {
  if (!n) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = +n || 0, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function historyTypeLabel(type) {
  return ({
    course: t('opt.history.type.course'),
    'zoom-links': t('opt.history.type.zoomlinks'),
    'zoom-videos': t('opt.history.type.zoomvideos'),
    legacySeen: t('opt.history.type.legacy'),
  })[type] || type || t('opt.history.fallback');
}

function historyStatusLabel(status) {
  return ({
    success: t('opt.history.status.success'),
    partial: t('opt.history.status.partial'),
    failed: t('opt.history.status.failed'),
  })[status] || '—';
}

// Loads all download-history entries (new downloadHistory list + legacy
// seen_<courseId> records) sorted newest-first. Shared by the history table
// and the time-saved counter.
async function loadHistoryEntries() {
  const stored = await chrome.storage.local.get(null);
  const entries = Array.isArray(stored[DOWNLOAD_HISTORY_KEY]) ? [...stored[DOWNLOAD_HISTORY_KEY]] : [];
  const seenCourseIdsInHistory = new Set(entries.map(e => String(e.courseId || '')).filter(Boolean));

  // Backward-compatible fallback: old versions only wrote seen_<courseId>.
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith('seen_')) continue;
    const courseId = key.slice(5);
    if (seenCourseIdsInHistory.has(courseId)) continue;
    entries.push({
      id: `legacy_${courseId}`,
      type: 'legacySeen',
      title: value.courseName || t('opt.history.legacy.course', { id: courseId }),
      courseId,
      sourceUrl: value.courseUrl || `https://moodlearn.ariel.ac.il/course/view.php?id=${encodeURIComponent(courseId)}`,
      finishedAt: value.lastDownload || 0,
      status: 'success',
      itemCount: (value.items || []).length,
      successCount: (value.items || []).length,
      failedCount: 0,
      bytes: 0,
    });
  }
  entries.sort((a, b) => (b.finishedAt || b.startedAt || 0) - (a.finishedAt || a.startedAt || 0));
  return entries;
}

// Rough estimate of the manual time each downloaded item would have cost
// (navigate to it, click, Save As, rename). Deliberately conservative.
const SECONDS_PER_ITEM = 25;

function formatDuration(totalSeconds) {
  const mins = Math.max(0, Math.round(totalSeconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? t('opt.stats.time.hm', { h, m }) : t('opt.stats.time.m', { m });
}

// Renders the "time you saved" card from the download history.
async function renderStats(entries) {
  const card = $('#statsCard');
  if (!card) return;
  entries = entries || await loadHistoryEntries();
  const totalItems = entries.reduce((sum, e) => sum + (e.itemCount ?? e.successCount ?? 0), 0);
  if (!entries.length || totalItems === 0) {
    card.innerHTML = `<p class="note">${escapeHtml(t('opt.stats.none'))}</p>`;
    return;
  }
  const time = formatDuration(totalItems * SECONDS_PER_ITEM);
  card.innerHTML = `
    <p class="headline">${escapeHtml(t('opt.stats.headline', { time }))}</p>
    <p class="sub">${escapeHtml(t('opt.stats.sub', { items: totalItems, n: entries.length }))}</p>
    <p class="note">${escapeHtml(t('opt.stats.note', { sec: SECONDS_PER_ITEM }))}</p>`;
}

async function renderHistory() {
  const entries = await loadHistoryEntries();

  const table = $('#historyTable');
  if (!entries.length) {
    table.innerHTML = `<tr><td class="empty">${escapeHtml(t('opt.history.empty'))}</td></tr>`;
    return;
  }
  const locale = (typeof MH_CURRENT_LANG !== 'undefined' && MH_CURRENT_LANG === 'en') ? 'en-US' : 'he-IL';
  const head = `
    <thead><tr>
      <th>${escapeHtml(t('opt.history.col.download'))}</th>
      <th>${escapeHtml(t('opt.history.col.type'))}</th>
      <th>${escapeHtml(t('opt.history.col.items'))}</th>
      <th>${escapeHtml(t('opt.history.col.status'))}</th>
      <th>${escapeHtml(t('opt.history.col.size'))}</th>
      <th>${escapeHtml(t('opt.history.col.date'))}</th>
      <th>${escapeHtml(t('opt.history.col.action'))}</th>
    </tr></thead>`;
  const rows = entries.slice(0, 200).map(e => {
    const total = e.itemCount ?? e.successCount ?? 0;
    const counts = e.failedCount
      ? t('opt.history.counts', { ok: e.successCount || 0, total, failed: e.failedCount })
      : String(total || '—');
    const url = e.sourceUrl || (e.courseId ? `https://moodlearn.ariel.ac.il/course/view.php?id=${encodeURIComponent(e.courseId)}` : '');
    const action = url ? `<a href="${escapeHtml(url)}" target="_blank" style="color: var(--accent);">${escapeHtml(t('opt.history.open'))}</a>` : '—';
    return `
      <tr>
        <td>${escapeHtml(e.title || e.filename || t('opt.history.fallback'))}</td>
        <td>${escapeHtml(historyTypeLabel(e.type))}</td>
        <td>${escapeHtml(counts)}</td>
        <td>${escapeHtml(historyStatusLabel(e.status))}</td>
        <td>${formatBytes(e.bytes)}</td>
        <td>${e.finishedAt || e.startedAt ? new Date(e.finishedAt || e.startedAt).toLocaleString(locale) : '—'}</td>
        <td>${action}</td>
      </tr>`;
  }).join('');
  table.innerHTML = head + '<tbody>' + rows + '</tbody>';
}

// Strings that aren't bound via [data-i18n] in the HTML (built in JS or
// needing a runtime value like the year). Safe to call repeatedly — runs
// on init and again whenever the UI language changes.
function applyDynamicI18n() {
  const copy = $('#aboutCopy');
  if (copy) copy.textContent = t('opt.about.copy', { year: new Date().getFullYear() });
}

// Last update-check result, kept so the banner text can be re-rendered when
// the UI language changes.
let lastUpdateInfo = null;

function showUpdateResult(info, { showResultLine = true } = {}) {
  lastUpdateInfo = info;
  const head = $('#updateBannerHead');
  const banner = $('#updateBanner');
  const result = $('#updateCheckResult');
  if (info && info.hasUpdate) {
    const msg = t('opt.updates.available', { v: info.latest });
    if (head) head.textContent = msg;
    if (banner) banner.style.display = 'block';
    if (result && showResultLine) result.textContent = msg;
  } else {
    if (banner) banner.style.display = 'none';
    if (result && showResultLine) {
      result.textContent = info && info.error
        ? t('opt.updates.failed')
        : t('opt.updates.uptodate', { v: (info && info.current) || mhCurrentVersion() });
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

(async function init() {
  const settings = await getSettings();
  applyTheme(settings.theme);
  applyAccent(settings.accentColor);
  // Resolve and apply UI language (ROADMAP #16). The options page is a
  // tab — no active Moodle tab to sniff a course lang from — so 'auto'
  // falls through to navigator.language.
  if (typeof applyLanguage === 'function') {
    applyLanguage(resolveLanguage(settings.uiLanguage, null));
  }
  applyDynamicI18n();

  // toggles
  for (const input of $$('input.toggle')) {
    const key = input.dataset.setting;
    if (key) bindToggle(input, key, settings);
  }
  // text + number inputs
  for (const input of $$('input[type="text"][data-setting], input[type="number"][data-setting]')) {
    bindText(input, input.dataset.setting, settings);
  }
  // radio groups — theme gets a live applyTheme callback so the page
  // re-themes instantly (no reload, no relying on radio change events
  // which don't always fire on display:none inputs).
  for (const wrap of $$('.radios[data-setting]')) {
    const key = wrap.dataset.setting;
    let onChange = null;
    if (key === 'theme') onChange = applyTheme;
    else if (key === 'accentColor') onChange = applyAccent;
    else if (key === 'uiLanguage') {
      // Live re-translate when the user picks a different language. 'auto'
      // resolves against navigator.language here (no active Moodle tab in
      // the options page). Re-render the JS-built bits (file types, history,
      // about line) so they switch language too — not just [data-i18n] nodes.
      onChange = async (v) => {
        applyLanguage(resolveLanguage(v, null));
        applyDynamicI18n();
        const s = await getSettings();
        renderFileTypes(s);
        await renderHistory();
        await renderStats();
        if (lastUpdateInfo) showUpdateResult(lastUpdateInfo, { showResultLine: false });
      };
    }
    bindRadios(wrap, key, settings, onChange);
  }

  renderFileTypes(settings);
  await renderHistory();
  await renderStats();

  // Donation button — only shown once MH_DONATE_URL is configured in updates.js.
  const donate = $('#donateBtn');
  if (donate && typeof MH_DONATE_URL === 'string' && MH_DONATE_URL.trim()) {
    donate.href = MH_DONATE_URL.trim();
    donate.style.display = 'inline-block';
  }

  // ----- Updates -----
  const cv = $('#currentVersion');
  if (cv && typeof mhCurrentVersion === 'function') cv.textContent = 'v' + mhCurrentVersion();
  $('#updateOpenExt')?.addEventListener('click', () => { if (typeof mhOpenExtensionsPage === 'function') mhOpenExtensionsPage(); });
  $('#checkUpdateNow')?.addEventListener('click', async () => {
    const result = $('#updateCheckResult');
    if (result) result.textContent = t('opt.updates.checking');
    const info = await mhCheckForUpdate(true);
    showUpdateResult(info);
  });
  // Passive, throttled check on open — only surface the banner if newer.
  if (settings.checkUpdates !== false && typeof mhCheckForUpdate === 'function') {
    mhCheckForUpdate(false)
      .then(info => { if (info && info.hasUpdate) showUpdateResult(info, { showResultLine: false }); })
      .catch(() => {});
  }

  $('#clearHistory').addEventListener('click', async () => {
    if (!confirm(t('opt.history.clear.confirm'))) return;
    const stored = await chrome.storage.local.get(null);
    const toRemove = Object.keys(stored).filter(k => k.startsWith('seen_'));
    toRemove.push(DOWNLOAD_HISTORY_KEY);
    await chrome.storage.local.remove(toRemove);
    await renderHistory();
    flashSaved();
  });

  $('#resetSettings').addEventListener('click', async () => {
    if (!confirm(t('opt.reset.confirm'))) return;
    await resetSettings();
    // reload UI
    location.reload();
  });
})();
