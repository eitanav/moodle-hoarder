// Options page logic. Binds form controls to chrome.storage via settings.js.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const DOWNLOAD_HISTORY_KEY = 'downloadHistory';

const FILETYPE_LABELS = {
  resource:    'קובץ (Resource)',
  folder:      'תיקייה (Folder)',
  assign:      'מטלה (Assignment)',
  url:         'קישור (URL)',
  page:        'דף (Page)',
  book:        'ספר (Book)',
  quiz:        'בוחן (Quiz)',
  lesson:      'שיעור (Lesson)',
  forum:       'פורום (Forum)',
  chat:        'צ׳אט (Chat)',
  feedback:    'משוב (Feedback)',
  choice:      'בחירה (Choice)',
  wiki:        'ויקי (Wiki)',
  glossary:    'מילון (Glossary)',
  workshop:    'סדנה (Workshop)',
  scorm:       'SCORM',
  h5pactivity: 'H5P',
};

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
  for (const [type, label] of Object.entries(FILETYPE_LABELS)) {
    const enabled = settings.fileTypes[type] !== false;
    const lbl = document.createElement('label');
    lbl.innerHTML = `<input type="checkbox" ${enabled ? 'checked' : ''}> <span></span>`;
    lbl.querySelector('span').textContent = label;
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
    course: 'קורס ZIP',
    'zoom-links': 'Zoom קישורים/תמלילים',
    'zoom-videos': 'Zoom סרטונים',
    legacySeen: 'קורס (Diff ישן)',
  })[type] || type || 'הורדה';
}

function historyStatusLabel(status) {
  return ({ success: 'הצליח', partial: 'חלקי', failed: 'נכשל' })[status] || '—';
}

async function renderHistory() {
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
      title: value.courseName || `קורס ${courseId}`,
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

  const table = $('#historyTable');
  if (!entries.length) {
    table.innerHTML = `<tr><td class="empty">עוד לא הורדת אף קורס או הקלטה</td></tr>`;
    return;
  }
  const head = `
    <thead><tr>
      <th>הורדה</th>
      <th>סוג</th>
      <th>פריטים</th>
      <th>סטטוס</th>
      <th>גודל</th>
      <th>תאריך</th>
      <th>פעולה</th>
    </tr></thead>`;
  const rows = entries.slice(0, 200).map(e => {
    const total = e.itemCount ?? e.successCount ?? 0;
    const counts = e.failedCount ? `${e.successCount || 0}/${total} (${e.failedCount} נכשלו)` : String(total || '—');
    const url = e.sourceUrl || (e.courseId ? `https://moodlearn.ariel.ac.il/course/view.php?id=${encodeURIComponent(e.courseId)}` : '');
    const action = url ? `<a href="${escapeHtml(url)}" target="_blank" style="color: var(--accent);">פתח</a>` : '—';
    return `
      <tr>
        <td>${escapeHtml(e.title || e.filename || 'הורדה')}</td>
        <td>${escapeHtml(historyTypeLabel(e.type))}</td>
        <td>${escapeHtml(counts)}</td>
        <td>${escapeHtml(historyStatusLabel(e.status))}</td>
        <td>${formatBytes(e.bytes)}</td>
        <td>${e.finishedAt || e.startedAt ? new Date(e.finishedAt || e.startedAt).toLocaleString('he-IL') : '—'}</td>
        <td>${action}</td>
      </tr>`;
  }).join('');
  table.innerHTML = head + '<tbody>' + rows + '</tbody>';
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
      // the options page).
      onChange = (v) => applyLanguage(resolveLanguage(v, null));
    }
    bindRadios(wrap, key, settings, onChange);
  }

  renderFileTypes(settings);
  await renderHistory();

  $('#clearHistory').addEventListener('click', async () => {
    if (!confirm('למחוק את כל היסטוריית הקורסים שהורדת? (לא ימחק קבצים שכבר ירדו)')) return;
    const stored = await chrome.storage.local.get(null);
    const toRemove = Object.keys(stored).filter(k => k.startsWith('seen_'));
    toRemove.push(DOWNLOAD_HISTORY_KEY);
    await chrome.storage.local.remove(toRemove);
    await renderHistory();
    flashSaved();
  });

  $('#resetSettings').addEventListener('click', async () => {
    if (!confirm('לאפס את כל ההגדרות לברירת המחדל?')) return;
    await resetSettings();
    // reload UI
    location.reload();
  });
})();
