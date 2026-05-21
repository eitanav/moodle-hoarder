// Options page logic. Binds form controls to chrome.storage via settings.js.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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

async function renderHistory() {
  const stored = await chrome.storage.local.get(null);
  const courses = [];
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith('seen_')) continue;
    const courseId = key.slice(5);
    courses.push({
      id: courseId,
      lastDownload: value.lastDownload || 0,
      itemCount: (value.items || []).length,
      name: value.courseName || `קורס ${courseId}`,
    });
  }
  courses.sort((a, b) => b.lastDownload - a.lastDownload);

  const table = $('#historyTable');
  if (!courses.length) {
    table.innerHTML = `<tr><td class="empty">עוד לא הורדת אף קורס</td></tr>`;
    return;
  }
  const head = `
    <thead><tr>
      <th>קורס</th>
      <th>פריטים</th>
      <th>תאריך</th>
      <th>פעולה</th>
    </tr></thead>`;
  const rows = courses.map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${c.itemCount}</td>
      <td>${c.lastDownload ? new Date(c.lastDownload).toLocaleString('he-IL') : '—'}</td>
      <td><a href="https://moodlearn.ariel.ac.il/course/view.php?id=${encodeURIComponent(c.id)}" target="_blank" style="color: var(--accent);">פתח</a></td>
    </tr>`).join('');
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
