// ===================== Moodle Hoarder =====================
// Popup orchestrates: scan -> pick -> download -> zip.

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const initialView   = $('initial');
const pickerView    = $('picker');
const multiView     = $('multiPicker');
const sectionsEl    = $('sections');
const coursesEl     = $('courses');
const searchEl      = $('search');
const selCountEl    = $('selCount');
const totCountEl    = $('totCount');
const totCoursesEl  = $('totCourses');
const statusEl      = $('status');
const logEl         = $('log');
const progressWrap  = $('progressWrap');
const progressBar   = $('progressBar');
const diffBanner    = $('diffBanner');
const diffText      = $('diffText');

let scanned = null;        // single course: { courseName, courseId, courseUrl, sections, prevSeen }
let multiScanned = null;   // multi: { courses: [{id, name, url}] }

// ---------- Constants ----------
const ACTIVITY_RE = /\/mod\/(resource|folder|assign|url|page|book|forum|quiz|lesson|choice|feedback|workshop|wiki|chat|glossary|scorm|h5pactivity)\/view\.php\?(?:[^#]*&)?id=(\d+)/;
const ALWAYS_OFF_TYPES = new Set(['forum','chat','feedback','choice','wiki','glossary']);
const INTRO_OFF_TYPES  = new Set(['url']);
const STREAM_HOSTS = [
  // Recording / video platforms
  'zoom.us','panopto','kaltura','mediasite','youtu','vimeo.com','dailymotion','twitch.tv',
  // Conference / meeting platforms (links won't be live anymore, but worth keeping for reference)
  'teams.microsoft.com','meet.google.com','meet.goto.com','gotomeeting.com','goto.com',
  'webex.com','meet.jit.si','whereby.com','bigbluebutton',
  // File-share / cloud
  'sharepoint.com','onedrive','drive.google.com','docs.google.com','dropbox.com','box.com',
  // Social video
  'facebook.com','instagram.com','tiktok.com',
];

// Only these hosts are in our manifest's host_permissions — fetching anything else
// triggers a CORS error in chrome://extensions even if try/catch'd. Save as link instead.
function isAllowedHost(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return host === 'ariel.ac.il' || host.endsWith('.ariel.ac.il');
  } catch { return false; }
}

// ---------- Status helpers ----------
function setStatus(t) { statusEl.textContent = t; }
function logLine(t, cls = '') {
  logEl.classList.add('show');
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = t;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function setProgress(done, total) {
  if (total <= 0) { progressWrap.style.display = 'none'; return; }
  progressWrap.style.display = 'block';
  progressBar.style.width = Math.round((done / total) * 100) + '%';
}
function showView(name) {
  initialView.style.display = name === 'initial' ? 'block' : 'none';
  pickerView.style.display  = name === 'picker'  ? 'block' : 'none';
  multiView.style.display   = name === 'multi'   ? 'block' : 'none';
}

// ---------- Initial: scan button ----------
$('scan').addEventListener('click', async () => {
  $('scan').disabled = true;
  setStatus('בודק עמוד...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error('אין טאב פעיל');

    if (/zoom\.us/.test(tab.url)) {
      setStatus('ממתין שדף ה-Zoom ייטען...');
      // Wait for the SPA to render its rows; poll until row count stabilizes.
      await waitForZoomList(tab.id);
      setStatus('סורק טבלת הקלטות...');
      const data = await extractZoomRecordings(tab.id);
      await saveZoomFile(data);
      if (data.recordings.length === 0) {
        setStatus('לא נמצאו הקלטות. ראה את הקובץ שירד לפרטים.');
      } else {
        setStatus(`הושלם: ${data.recordings.length} הקלטות.`);
        notify('Moodle Hoarder', `נמצאו ${data.recordings.length} הקלטות Zoom`);
      }
      $('scan').disabled = false;
      return;
    } else if (/moodlearn\.ariel\.ac\.il\/my\/(courses\.php|index\.php)/.test(tab.url)) {
      setStatus('סורק קורסים...');
      const res = await fetch(tab.url, { credentials: 'include' });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const courses = extractCourses(doc);
      if (!courses.length) {
        setStatus('לא נמצאו קורסים בדף.');
        $('scan').disabled = false;
        return;
      }
      multiScanned = { courses };
      renderMulti();
    } else if (/moodlearn\.ariel\.ac\.il\/course\/view\.php/.test(tab.url)) {
      setStatus('סורק קורס...');
      scanned = await scanCourse(tab.url);
      if (!scanned.sections.length) {
        setStatus('לא נמצאו פריטים בדף.');
        $('scan').disabled = false;
        return;
      }
      renderPicker();
    } else {
      setStatus('יש לעבור לדף קורס במודל אריאל או לדף "הקורסים שלי".');
      $('scan').disabled = false;
    }
  } catch (e) {
    setStatus('שגיאה: ' + e.message);
    $('scan').disabled = false;
  }
});

async function scanCourse(courseUrl) {
  const res = await fetch(courseUrl, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const data = extractCourse(doc);
  data.courseUrl = courseUrl;
  data.prevSeen = await loadSeen(data.courseId);
  return data;
}

// ========== Extraction (works on any Document) ==========
function extractCourse(doc) {
  const courseName = (doc.querySelector('.page-header-headings h1, header h1, h1')?.textContent
                      || doc.title || 'course').trim();
  const courseId = (doc.querySelector('[data-courseid]')?.getAttribute('data-courseid'))
                 || (doc.querySelector('body')?.id?.match(/course-(\d+)/)?.[1])
                 || '';

  // Try to find proper sections
  const secEls = doc.querySelectorAll('li.section.main, li[id^="section-"], section.section.main, [data-region="course-section"]');
  const sections = [];
  let idx = 0;
  const seen = new Set();

  const collect = (root, sectionName) => {
    const items = [];
    for (const a of root.querySelectorAll('a[href]')) {
      const m = a.href.match(ACTIVITY_RE);
      if (!m) continue;
      const key = m[1] + ':' + m[2];
      if (seen.has(key)) continue;
      seen.add(key);
      const nameEl = a.querySelector('.instancename');
      let name = '';
      if (nameEl) {
        const c = nameEl.cloneNode(true);
        c.querySelectorAll('.accesshide').forEach(n => n.remove());
        name = c.textContent.trim();
      } else {
        name = (a.textContent || '').trim();
      }
      items.push({ idx: idx++, type: m[1], id: m[2], url: a.href, name: name || `${m[1]}_${m[2]}`, section: sectionName });
    }
    return items;
  };

  for (const sec of secEls) {
    const nameEl = sec.querySelector('.sectionname, h3.sectionname, .course-section-header, h3');
    const sName = (nameEl?.textContent || '').trim() || `קטע ${sections.length + 1}`;
    const items = collect(sec, sName);
    if (items.length) sections.push({ name: sName, items });
  }

  if (!sections.length) {
    // Fallback: no section structure detected → one bucket
    const all = collect(doc.body || doc, 'הכל');
    if (all.length) sections.push({ name: 'הכל', items: all });
  }

  return { courseName, courseId, sections };
}

function extractCourses(doc) {
  const courses = [];
  const seen = new Set();
  // Course cards on /my/courses.php — match links to course/view.php?id=...
  for (const a of doc.querySelectorAll('a[href*="/course/view.php?id="]')) {
    const m = a.href.match(/[?&]id=(\d+)/);
    if (!m) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    // Skip non-course links (navigation)
    const text = (a.querySelector('.coursename .multiline')?.textContent
                  || a.querySelector('.coursename')?.textContent
                  || a.getAttribute('aria-label')
                  || a.textContent || '').trim();
    if (!text) continue;
    seen.add(id);
    courses.push({ id, name: text, url: a.href });
  }
  return courses;
}

// ========== Picker rendering ==========
function renderPicker() {
  showView('picker');
  sectionsEl.innerHTML = '';

  let total = 0;
  scanned.sections.forEach((sec, sIdx) => {
    const secDiv = document.createElement('div');
    secDiv.className = 'section';
    secDiv.innerHTML = `
      <div class="section-header">
        <input type="checkbox" class="sec-master">
        <span class="sec-name"></span>
        <span class="sec-count"></span>
        <span class="caret">▼</span>
      </div>
      <ul class="section-items"></ul>`;
    secDiv.querySelector('.sec-name').textContent = sec.name;
    secDiv.querySelector('.sec-count').textContent = `${sec.items.length} פריטים`;
    const ul = secDiv.querySelector('.section-items');

    sec.items.forEach(item => {
      const isNew = !isPreviouslySeen(scanned.prevSeen, item);
      const defChecked = defaultChecked(item, sIdx);
      const li = document.createElement('li');
      li.dataset.idx = item.idx;
      li.innerHTML = `
        <input type="checkbox" ${defChecked ? 'checked' : ''}>
        <span class="name"></span>
        <span class="chip"></span>`;
      li.querySelector('.name').textContent = item.name;
      const chip = li.querySelector('.chip');
      chip.textContent = item.type;
      if (isNew && scanned.prevSeen) {
        const n = document.createElement('span');
        n.className = 'chip new';
        n.textContent = 'חדש';
        chip.after(n);
      }
      li.querySelector('input').addEventListener('change', () => {
        updateSectionMaster(secDiv);
        updateSelCount();
      });
      ul.appendChild(li);
      total++;
    });

    // Section header behaviors
    const header = secDiv.querySelector('.section-header');
    const master = secDiv.querySelector('.sec-master');
    header.addEventListener('click', (e) => {
      if (e.target === master) return;
      secDiv.classList.toggle('collapsed');
    });
    master.addEventListener('click', (e) => e.stopPropagation());
    master.addEventListener('change', () => {
      ul.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = master.checked);
      updateSelCount();
    });
    updateSectionMaster(secDiv);
    sectionsEl.appendChild(secDiv);
  });

  totCountEl.textContent = total;

  // Diff banner if we have prior data
  if (scanned.prevSeen && scanned.prevSeen.items?.length) {
    const newCount = countNew();
    diffText.textContent = `נמצאה הורדה קודמת מתאריך ${formatDateShort(scanned.prevSeen.lastDownload)} — ${newCount} פריטים חדשים מאז.`;
    diffBanner.classList.add('show');
  } else {
    diffBanner.classList.remove('show');
  }

  updateSelCount();
  setStatus('');
}

function defaultChecked(item, sectionIdx) {
  if (ALWAYS_OFF_TYPES.has(item.type)) return false;
  if (sectionIdx === 0 && INTRO_OFF_TYPES.has(item.type)) return false;
  return true;
}

function isPreviouslySeen(prev, item) {
  if (!prev || !prev.items) return false;
  return prev.items.some(p => p.type === item.type && p.id === item.id);
}

function countNew() {
  let n = 0;
  scanned.sections.forEach(sec => sec.items.forEach(it => {
    if (!isPreviouslySeen(scanned.prevSeen, it)) n++;
  }));
  return n;
}

function updateSectionMaster(secDiv) {
  const boxes = secDiv.querySelectorAll('.section-items input[type=checkbox]');
  const m = secDiv.querySelector('.sec-master');
  const checked = [...boxes].filter(b => b.checked).length;
  m.checked = checked === boxes.length && boxes.length > 0;
  m.indeterminate = checked > 0 && checked < boxes.length;
}

function updateSelCount() {
  const n = sectionsEl.querySelectorAll('.section-items input[type=checkbox]:checked').length;
  selCountEl.textContent = n;
  $('download').disabled = n === 0;
}

// Selection helpers
$('selAll').addEventListener('click', () => {
  sectionsEl.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = true);
  sectionsEl.querySelectorAll('.section').forEach(updateSectionMaster);
  updateSelCount();
});
$('selNone').addEventListener('click', () => {
  sectionsEl.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = false);
  sectionsEl.querySelectorAll('.section').forEach(updateSectionMaster);
  updateSelCount();
});
$('selDefaults').addEventListener('click', () => {
  scanned.sections.forEach((sec, sIdx) => {
    sec.items.forEach(it => {
      const li = sectionsEl.querySelector(`li[data-idx="${it.idx}"]`);
      if (li) li.querySelector('input').checked = defaultChecked(it, sIdx);
    });
  });
  sectionsEl.querySelectorAll('.section').forEach(updateSectionMaster);
  updateSelCount();
});
$('selOnlyNew').addEventListener('click', () => {
  scanned.sections.forEach(sec => sec.items.forEach(it => {
    const li = sectionsEl.querySelector(`li[data-idx="${it.idx}"]`);
    if (li) li.querySelector('input').checked = !isPreviouslySeen(scanned.prevSeen, it);
  }));
  sectionsEl.querySelectorAll('.section').forEach(updateSectionMaster);
  updateSelCount();
});
$('selAllInBanner').addEventListener('click', () => $('selAll').click());

searchEl.addEventListener('input', () => {
  const q = searchEl.value.toLowerCase().trim();
  sectionsEl.querySelectorAll('.section-items li').forEach(li => {
    const n = li.querySelector('.name').textContent.toLowerCase();
    li.classList.toggle('hidden', q && !n.includes(q));
  });
});

$('back').addEventListener('click', () => {
  showView('initial');
  $('scan').disabled = false;
  resetFooter();
});

// ========== Multi-course rendering ==========
function renderMulti() {
  showView('multi');
  coursesEl.innerHTML = '';
  totCoursesEl.textContent = multiScanned.courses.length;
  for (const c of multiScanned.courses) {
    const li = document.createElement('li');
    li.dataset.id = c.id;
    li.innerHTML = `
      <input type="checkbox" checked>
      <div style="flex:1;overflow:hidden;">
        <div class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        <div class="id">ID ${c.id}</div>
      </div>`;
    li.querySelector('.name').textContent = c.name;
    li.querySelector('input').addEventListener('change', updateCourseCount);
    coursesEl.appendChild(li);
  }
  updateCourseCount();
}
function updateCourseCount() {
  const n = coursesEl.querySelectorAll('input[type=checkbox]:checked').length;
  $('downloadMulti').disabled = n === 0;
}
$('courseAll').addEventListener('click', () => {
  coursesEl.querySelectorAll('input').forEach(c => c.checked = true);
  updateCourseCount();
});
$('courseNone').addEventListener('click', () => {
  coursesEl.querySelectorAll('input').forEach(c => c.checked = false);
  updateCourseCount();
});
$('searchCourses').addEventListener('input', () => {
  const q = $('searchCourses').value.toLowerCase().trim();
  coursesEl.querySelectorAll('li').forEach(li => {
    const n = li.querySelector('.name').textContent.toLowerCase();
    li.style.display = (q && !n.includes(q)) ? 'none' : '';
  });
});
$('backMulti').addEventListener('click', () => {
  showView('initial');
  $('scan').disabled = false;
  resetFooter();
});

// ========== Download (single course) ==========
$('download').addEventListener('click', async () => {
  const selected = collectSelectedItems();
  if (!selected.length) return;
  $('download').disabled = true;
  $('back').disabled = true;

  await runDownload({
    courseName: scanned.courseName,
    courseId: scanned.courseId,
    courseUrl: scanned.courseUrl,
    items: selected,
  });

  $('back').disabled = false;
});

function collectSelectedItems() {
  const sel = [];
  scanned.sections.forEach(sec => sec.items.forEach(it => {
    const li = sectionsEl.querySelector(`li[data-idx="${it.idx}"]`);
    if (li && li.querySelector('input').checked) sel.push(it);
  }));
  return sel;
}

// ========== Download (multi-course) ==========
$('downloadMulti').addEventListener('click', async () => {
  const wanted = [...coursesEl.querySelectorAll('li')]
    .filter(li => li.querySelector('input').checked)
    .map(li => multiScanned.courses.find(c => c.id === li.dataset.id));
  if (!wanted.length) return;
  $('downloadMulti').disabled = true;
  $('backMulti').disabled = true;
  const onlyNew = $('onlyNewMulti').checked;

  logEl.innerHTML = '';
  for (let i = 0; i < wanted.length; i++) {
    const c = wanted[i];
    setStatus(`(${i + 1}/${wanted.length}) ${c.name}`);
    try {
      const data = await scanCourse(c.url);
      let items = [];
      data.sections.forEach((sec, sIdx) => sec.items.forEach(it => {
        if (onlyNew && isPreviouslySeen(data.prevSeen, it)) return;
        if (defaultChecked(it, sIdx)) items.push(it);
      }));
      if (!items.length) { logLine(`— ${c.name}: אין מה להוריד`, 'ok'); continue; }
      await runDownload({
        courseName: data.courseName,
        courseId: data.courseId,
        courseUrl: c.url,
        items,
        silent: true,
      });
      logLine(`✓ ${c.name}: ${items.length} פריטים`, 'ok');
    } catch (e) {
      logLine(`✗ ${c.name}: ${e.message}`, 'err');
    }
  }
  setStatus('הושלם.');
  setProgress(0, 0);
  notify('Moodle Hoarder', `הסתיימה הורדת ${wanted.length} קורסים`);
  $('backMulti').disabled = false;
});

// ========== Core download routine ==========
async function runDownload({ courseName, courseId, courseUrl, items, silent }) {
  if (!silent) logEl.innerHTML = '';
  setProgress(0, items.length);

  const files = [];
  const links = [];      // generic URL activities
  const recordings = []; // streaming
  const events = [];     // calendar deadlines
  const errors = [];
  const used = new Set();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    setStatus(`(${i + 1}/${items.length}) ${item.name}`);
    setProgress(i, items.length);
    try {
      const got = await fetchItem(item);
      for (const r of got) {
        if (r.kind === 'recording') recordings.push(r);
        else if (r.kind === 'link') links.push(r);
        else if (r.kind === 'event') events.push(r.event);
        else {
          r.path = uniquePath(used, r.path);
          files.push(r);
          if (!silent) logLine(`✓ ${r.path} (${formatSize(r.blob.size)})`, 'ok');
        }
      }
    } catch (e) {
      errors.push({ item, err: e.message });
      if (!silent) logLine(`✗ ${item.name}: ${e.message}`, 'err');
    }
  }

  // Companion files inside the ZIP
  if (links.length) {
    files.push({ path: 'links.txt', blob: textBlob(formatLinkList(links, 'קישורים')) });
  }
  if (recordings.length) {
    files.push({ path: 'recordings.txt', blob: textBlob(formatLinkList(recordings, 'הקלטות וסרטונים')) });
  }
  if (events.length) {
    files.push({ path: 'deadlines.ics', blob: textBlob(buildICS(events, courseName), 'text/calendar;charset=utf-8') });
  }
  const info = buildInfo({ courseName, courseUrl, items, files, links, recordings, events, errors });
  files.push({ path: 'info.txt', blob: textBlob(info) });

  setStatus(`מארז ZIP...`);
  setProgress(items.length, items.length);

  const zipBlob = await buildZip(files);
  const blobUrl = URL.createObjectURL(zipBlob);
  const filename = sanitizeFilename(courseName) + '.zip';
  await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });

  // Persist "seen" snapshot
  if (courseId) await saveSeen(courseId, items);

  setStatus(`הושלם: ${files.length} פריטים, ${formatSize(zipBlob.size)}.`);
  if (!silent) notify('Moodle Hoarder', `הורדו ${files.length} פריטים מ-"${courseName}"`);
}

function buildInfo({ courseName, courseUrl, items, files, links, recordings, events, errors }) {
  const lines = [];
  lines.push('Moodle Hoarder');
  lines.push('===============');
  lines.push(`קורס: ${courseName}`);
  lines.push(`כתובת: ${courseUrl}`);
  lines.push(`תאריך הורדה: ${new Date().toLocaleString('he-IL')}`);
  lines.push(`קבצים: ${files.length}`);
  lines.push(`קישורים: ${links.length}`);
  lines.push(`הקלטות: ${recordings.length}`);
  lines.push(`דדליינים ביומן: ${events.length}`);
  lines.push(`שגיאות: ${errors.length}`);
  lines.push('');
  if (errors.length) {
    lines.push('-- שגיאות --');
    for (const { item, err } of errors) lines.push(`✗ [${item.type}] ${item.name} — ${err}`);
    lines.push('');
  }
  lines.push('-- פריטים שנבחרו --');
  for (const it of items) lines.push(`[${it.type}] ${it.name}`);
  return lines.join('\r\n');
}

function formatLinkList(arr, title) {
  const lines = [title, '='.repeat(title.length), ''];
  for (const l of arr) lines.push(`[${l.type || 'url'}] ${l.name}\n${l.url}\n`);
  return lines.join('\r\n');
}

function textBlob(s, type = 'text/plain;charset=utf-8') {
  return new Blob(['﻿' + s], { type }); // BOM for Windows Notepad readability
}

function resetFooter() {
  setStatus('');
  setProgress(0, 0);
  logEl.classList.remove('show');
  logEl.innerHTML = '';
}

function notify(title, message) {
  try {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title, message });
  } catch {}
}

// ========== Storage (diff mode) ==========
async function loadSeen(courseId) {
  if (!courseId) return null;
  const key = `seen_${courseId}`;
  const obj = await chrome.storage.local.get(key);
  return obj[key] || null;
}
async function saveSeen(courseId, items) {
  const key = `seen_${courseId}`;
  await chrome.storage.local.set({
    [key]: { lastDownload: Date.now(), items: items.map(i => ({ type: i.type, id: i.id })) }
  });
}
function formatDateShort(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('he-IL');
}

// ========== Fetchers ==========
function isStreamingUrl(u) {
  try { return STREAM_HOSTS.some(h => new URL(u).hostname.toLowerCase().includes(h)); }
  catch { return false; }
}

async function fetchItem(item) {
  switch (item.type) {
    case 'resource': return await fetchResource(item);
    case 'folder':   return await fetchFolder(item);
    case 'assign':   return await fetchAssign(item);
    case 'url':      return await fetchUrlActivity(item);
    case 'page':     return await fetchPage(item);
    case 'book':     return await fetchBook(item);
    default:
      return [{ kind: 'link', type: item.type, name: item.name, url: item.url }];
  }
}

async function fetchResource(item) {
  const url = item.url + (item.url.includes('?') ? '&' : '?') + 'redirect=1';
  let res = await fetch(url, { credentials: 'include' });
  const ct = (res.headers.get('Content-Type') || '').toLowerCase();
  if (ct.includes('text/html')) {
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const link = doc.querySelector('a[href*="pluginfile.php"], object[data*="pluginfile.php"], iframe[src*="pluginfile.php"]');
    const fileUrl = link?.href || link?.getAttribute?.('data') || link?.src;
    if (!fileUrl) throw new Error('לא נמצא קובץ');
    res = await fetch(fileUrl, { credentials: 'include' });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const fn = filenameFromResponse(res) || sanitizeFilename(item.name) || `resource_${item.id}`;
  return [{ path: fn, blob }];
}

async function fetchFolder(item) {
  const u = new URL(item.url);
  const dlUrl = `${u.origin}/mod/folder/download_folder.php?id=${item.id}`;
  try {
    const res = await fetch(dlUrl, { credentials: 'include' });
    const ct = (res.headers.get('Content-Type') || '').toLowerCase();
    if (res.ok && (ct.includes('zip') || ct.includes('octet-stream'))) {
      const blob = await res.blob();
      const fn = filenameFromResponse(res) || (sanitizeFilename(item.name) + '.zip');
      return [{ path: `folders/${fn}`, blob }];
    }
  } catch {}
  // Fallback: scrape
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const folder = sanitizeFilename(item.name) || `folder_${item.id}`;
  for (const a of doc.querySelectorAll('a[href*="pluginfile.php"]')) {
    try {
      const r = await fetch(a.href, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const fn = filenameFromResponse(r) || decodeURIComponent(a.href.split('/').pop()) || 'file';
      out.push({ path: `folders/${folder}/${fn}`, blob });
    } catch {}
  }
  if (!out.length) throw new Error('תיקייה ריקה / חסומה');
  return out;
}

async function fetchAssign(item) {
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const folder = sanitizeFilename(item.name) || `assign_${item.id}`;

  // Assignment materials (introattachments)
  const introLinks = new Set();
  for (const a of doc.querySelectorAll('a[href*="pluginfile.php"]')) {
    if (a.href.includes('/introattachment/') || a.href.includes('/mod_assign/intro')) introLinks.add(a.href);
  }
  for (const url of introLinks) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const fn = filenameFromResponse(r) || decodeURIComponent(url.split('/').pop()) || 'file';
      out.push({ path: `assignments/${folder}/${fn}`, blob });
    } catch {}
  }

  // Your submissions
  const subLinks = new Set();
  for (const a of doc.querySelectorAll('a[href*="pluginfile.php"]')) {
    if (a.href.includes('/assignsubmission_file/') || a.href.includes('/submission_files/')) subLinks.add(a.href);
  }
  for (const url of subLinks) {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const fn = filenameFromResponse(r) || decodeURIComponent(url.split('/').pop()) || 'file';
      out.push({ path: `submissions/${folder}/${fn}`, blob });
    } catch {}
  }

  // Due date → ICS event
  const due = extractAssignDue(doc);
  if (due) {
    out.push({ kind: 'event', event: {
      uid: `assign-${item.id}@moodle-hoarder`,
      summary: item.name,
      start: due,
      url: item.url,
      description: `מטלה במודל: ${item.name}`,
    }});
  }

  return out;
}

function extractAssignDue(doc) {
  // Look at "Due date" / "תאריך אחרון להגשה" rows; modern Moodle uses .activity-dates
  const candidates = [];
  for (const el of doc.querySelectorAll('.activity-dates div, .activity-dates [data-region="activity-date"], table tr td, .description-inner div, .description-content div')) {
    const t = (el.textContent || '').trim();
    if (!t) continue;
    if (/תאריך\s+אחרון|מועד\s+אחרון|due\s+date|cut[-\s]?off|deadline/i.test(t)) candidates.push(t);
  }
  // Sibling cell pattern (table-based assignment summary)
  for (const td of doc.querySelectorAll('td')) {
    if (/תאריך\s+אחרון|מועד\s+אחרון|due\s+date|cut[-\s]?off/i.test(td.textContent || '')) {
      const next = td.nextElementSibling;
      if (next) candidates.push(next.textContent.trim());
    }
  }
  for (const c of candidates) {
    const d = parseDate(c);
    if (d) return d;
  }
  return null;
}

async function fetchUrlActivity(item) {
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let external = doc.querySelector('a.urlworkaround')?.href
              || doc.querySelector('.urlworkaround a')?.href
              || doc.querySelector('main a[href^="http"]:not([href*="moodlearn"])')?.href;
  if (!external) {
    // meta refresh / inline JS redirect
    const m = html.match(/url\s*=\s*['"](https?:[^'"]+)['"]/i);
    if (m) external = m[1];
  }
  if (!external) {
    return [{ kind: 'link', type: 'url', name: item.name, url: item.url }];
  }

  // Streaming/recording → save as recording link only
  if (isStreamingUrl(external)) {
    return [{ kind: 'recording', type: 'recording', name: item.name, url: external }];
  }

  // Only attempt to download from hosts in our manifest permissions (Ariel domains).
  // Anything else would CORS-fail and pollute the extension error log; save as link.
  if (!isAllowedHost(external)) {
    return [{ kind: 'link', type: 'url', name: item.name, url: external }];
  }

  // Try fetching the external URL: if it answers with a file (Content-Disposition or
  // Content-Type non-HTML), save the bytes. This is the syllabus fast-path.
  try {
    const r = await fetch(external, { credentials: 'include' });
    if (r.ok) {
      const ct = (r.headers.get('Content-Type') || '').toLowerCase();
      const cd = (r.headers.get('Content-Disposition') || '').toLowerCase();
      const isAttachment = cd.includes('attachment') || /filename/i.test(cd);
      const fileyCT = /pdf|octet-stream|msword|officedocument|excel|powerpoint|zip|x-rar|x-7z|epub/i.test(ct);
      const looksLikeFile = isAttachment || fileyCT || /\.(pdf|docx?|pptx?|xlsx?|zip|rar|7z|epub)(\?|#|$)/i.test(external);
      if (looksLikeFile && !ct.includes('text/html')) {
        const blob = await r.blob();
        const fn = filenameFromResponse(r)
          || (sanitizeFilename(item.name) + (extFromCT(ct) || extFromUrl(external) || ''));
        return [{ path: `urls/${fn}`, blob }];
      }
    }
  } catch {}

  return [{ kind: 'link', type: 'url', name: item.name, url: external }];
}

async function fetchPage(item) {
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const content = doc.querySelector('[role="main"] .box.generalbox, #region-main .no-overflow, #region-main') || doc.body;
  const out = [];
  const folder = sanitizeFilename(item.name) || `page_${item.id}`;

  for (const a of content.querySelectorAll('a[href*="pluginfile.php"]')) {
    try {
      const r = await fetch(a.href, { credentials: 'include' });
      if (!r.ok) continue;
      const blob = await r.blob();
      const fn = filenameFromResponse(r) || decodeURIComponent(a.href.split('/').pop()) || 'file';
      out.push({ path: `pages/${folder}/${fn}`, blob });
    } catch {}
  }
  if (content.textContent.trim()) {
    const wrapped = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>${escapeHtml(item.name)}</title><style>body{font-family:Segoe UI,Arial,sans-serif;max-width:780px;margin:24px auto;padding:0 16px;line-height:1.6}@media print{body{margin:0}}</style>${content.outerHTML}`;
    out.push({ path: `pages/${folder}/index.html`, blob: new Blob([wrapped], { type: 'text/html;charset=utf-8' }) });
  }
  return out;
}

async function fetchBook(item) {
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  return [{ path: `books/${sanitizeFilename(item.name)}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) }];
}

// ========== ICS calendar ==========
function buildICS(events, courseName) {
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Moodle Hoarder//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  lines.push(`X-WR-CALNAME:${icsEsc(courseName || 'Moodle deadlines')}`);
  for (const e of events) {
    const start = formatICSDate(e.start);
    const end = formatICSDate(new Date(e.start.getTime() + 30 * 60 * 1000));
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${formatICSDate(new Date())}`);
    lines.push(`SUMMARY:${icsEsc(e.summary)}`);
    lines.push(`DTSTART:${start}`);
    lines.push(`DTEND:${end}`);
    if (e.url) lines.push(`URL:${icsEsc(e.url)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEsc(e.description)}`);
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${icsEsc(e.summary)}`);
    lines.push('TRIGGER:-PT1D');
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
function icsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, '\\$&').replace(/\n/g, '\\n'); }
function formatICSDate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// ========== Date parsing (he + en) ==========
const HE_MONTHS = { 'ינואר':0,'פברואר':1,'מרץ':2,'מרס':2,'אפריל':3,'מאי':4,'יוני':5,'יולי':6,'אוגוסט':7,'ספטמבר':8,'אוקטובר':9,'נובמבר':10,'דצמבר':11 };
const EN_MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDate(text) {
  if (!text) return null;
  text = text.trim();

  // 1) "1 ביוני 2026, 23:55" / "1 ביוני 2026"
  let m = text.match(/(\d{1,2})\s+ב?([א-ת]+)\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mo = HE_MONTHS[m[2]];
    if (mo != null) return new Date(+m[3], mo, +m[1], +m[4] || 23, +m[5] || 59);
  }
  // 2) "01/06/2026 23:55"  (DD/MM/YYYY)
  m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4] || 23, +m[5] || 59);
  // 3) "2026-06-01 23:55"
  m = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 23, +m[5] || 59);
  // 4) "1 June 2026, 23:55"
  m = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const mo = EN_MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo != null) return new Date(+m[3], mo, +m[1], +m[4] || 23, +m[5] || 59);
  }
  return null;
}

// ========== Helpers ==========
function filenameFromResponse(res) {
  const cd = res.headers.get('Content-Disposition');
  if (!cd) return null;
  let m = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (m) { try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch {} }
  m = cd.match(/filename\s*=\s*"([^"]+)"/i);
  if (m) return m[1];
  m = cd.match(/filename\s*=\s*([^;]+)/i);
  if (m) return m[1].trim();
  return null;
}
function extFromCT(ct) {
  if (!ct) return '';
  if (ct.includes('pdf')) return '.pdf';
  if (ct.includes('msword')) return '.doc';
  if (ct.includes('wordprocessingml')) return '.docx';
  if (ct.includes('presentationml')) return '.pptx';
  if (ct.includes('powerpoint')) return '.ppt';
  if (ct.includes('spreadsheetml')) return '.xlsx';
  if (ct.includes('excel')) return '.xls';
  if (ct.includes('zip')) return '.zip';
  if (ct.includes('rar')) return '.rar';
  return '';
}
function extFromUrl(u) {
  const m = u.match(/\.([a-z0-9]{2,5})(\?|#|$)/i);
  return m ? '.' + m[1].toLowerCase() : '';
}
function sanitizeFilename(name) {
  return (name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 150);
}
function uniquePath(used, path) {
  if (!used.has(path)) { used.add(path); return path; }
  const dot = path.lastIndexOf('.');
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : '';
  let i = 2;
  while (used.has(`${base} (${i})${ext}`)) i++;
  const p = `${base} (${i})${ext}`;
  used.add(p);
  return p;
}
function formatSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ===================== Zoom recordings (iteration 2) =====================
// Zoom LTI is a React SPA: recordings are <tr> rows, not <a href>. We scan
// table rows by content (topic + meeting ID + date) rather than by URL.

// Poll until row count is stable for ~1s, or 6s timeout.
async function waitForZoomList(tabId) {
  let last = -1, stable = 0;
  const start = Date.now();
  while (Date.now() - start < 6000) {
    let count = 0;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => document.querySelectorAll('table tbody tr, [role="rowgroup"] [role="row"]').length,
      });
      count = Math.max(0, ...results.map(r => r.result || 0));
    } catch {}
    if (count === last && count > 0) {
      stable += 500;
      if (stable >= 1000) return;
    } else {
      stable = 0;
    }
    last = count;
    await new Promise(r => setTimeout(r, 500));
  }
}

async function extractZoomRecordings(tabId) {
  let results = [];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scrapeZoomPage,
    });
  } catch (e) {
    return { pageUrl: '', recordings: [], debug: {}, frames: 0, error: e.message };
  }
  const out = { pageUrl: '', recordings: [], debug: {}, frames: results.length };
  for (const r of results) {
    if (!r?.result) continue;
    if (r.result.pageUrl && !out.pageUrl) out.pageUrl = r.result.pageUrl;
    out.recordings.push(...(r.result.recordings || []));
    Object.assign(out.debug, r.result.debug || {});
  }
  // Dedupe by meetingId+date (or by raw text if no id)
  const seen = new Set();
  out.recordings = out.recordings.filter(r => {
    const k = (r.meetingId || '') + '|' + (r.date || '') + '|' + (r.topic || '').slice(0, 30);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return out;
}

// Runs IN PAGE CONTEXT
function scrapeZoomPage() {
  // Zoom meeting IDs are 9-11 digits, usually displayed grouped: "843 9429 3109"
  const ZOOM_ID_RE = /\b(\d{3,4}\s+\d{3,4}\s+\d{3,4})\b/;
  // Dates: "May 19, 2025 8:42 AM" / "19/05/2025 8:42" / "2025-05-19"
  const DATE_RE = /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}(?:[\s,]+\d{1,2}:\d{2}(?:\s*[AaPp][Mm])?)?|\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2})?|\d{4}-\d{1,2}-\d{1,2})/;
  // Duration: "1h 30m" / "45m" / "1 hr 30 min"
  const DUR_RE = /(\d+\s*(?:h|hr|hrs|שעות|שעה)(?:\s*\d+\s*(?:m|min|mins|דקות))?|\d+\s*(?:m|min|mins|דקות))/i;

  const debug = { tables: 0, totalRows: 0, candidateRows: 0 };
  const recordings = [];

  // Strategy A: real <table> with <tbody><tr>
  const tables = document.querySelectorAll('table');
  debug.tables = tables.length;
  for (const table of tables) {
    const rows = table.querySelectorAll('tbody tr');
    debug.totalRows += rows.length;
    for (const row of rows) {
      const cells = [...row.querySelectorAll('td')];
      if (cells.length < 2) continue;
      const cellTexts = cells.map(c => (c.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
      if (!cellTexts.length) continue;
      const joined = cellTexts.join('  ');
      const idMatch = joined.match(ZOOM_ID_RE);
      const dateMatch = joined.match(DATE_RE);
      const durMatch = joined.match(DUR_RE);
      // Skip rows that don't look like recording entries
      if (!idMatch && !dateMatch) continue;
      debug.candidateRows++;
      // Topic: pick the first cell that isn't ID/date/duration
      let topic = '';
      for (const t of cellTexts) {
        if (idMatch && t.includes(idMatch[0])) continue;
        if (dateMatch && t.includes(dateMatch[0])) continue;
        if (durMatch && t === durMatch[0]) continue;
        if (/^\s*$/.test(t)) continue;
        topic = t;
        break;
      }
      if (!topic) topic = cellTexts[0] || '';
      recordings.push({
        topic,
        meetingId: idMatch ? idMatch[0].replace(/\s+/g, '') : '',
        date: dateMatch ? dateMatch[0] : '',
        duration: durMatch ? durMatch[0] : '',
        rawCells: cellTexts,
      });
    }
  }

  // Strategy B: ARIA grid rows (some SPAs)
  if (!recordings.length) {
    const ariaRows = document.querySelectorAll('[role="row"]');
    debug.totalRows += ariaRows.length;
    for (const row of ariaRows) {
      const cellNodes = row.querySelectorAll('[role="cell"], [role="gridcell"]');
      if (cellNodes.length < 2) continue;
      const cellTexts = [...cellNodes].map(c => (c.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
      const joined = cellTexts.join('  ');
      const idMatch = joined.match(ZOOM_ID_RE);
      const dateMatch = joined.match(DATE_RE);
      if (!idMatch && !dateMatch) continue;
      debug.candidateRows++;
      recordings.push({
        topic: cellTexts[0] || '',
        meetingId: idMatch ? idMatch[0].replace(/\s+/g, '') : '',
        date: dateMatch ? dateMatch[0] : '',
        duration: '',
        rawCells: cellTexts,
      });
    }
  }

  // Capture sample HTML for debugging when nothing matched
  if (!recordings.length) {
    const firstRow = document.querySelector('table tbody tr, [role="row"]');
    debug.firstRowHTML = firstRow ? firstRow.outerHTML.slice(0, 2000) : '(no rows in DOM)';
  }

  return { pageUrl: location.href, recordings, debug };
}

async function saveZoomFile(data) {
  const lines = [];
  lines.push('Moodle Hoarder — Zoom Recordings');
  lines.push('================================');
  lines.push(`Source: ${data.pageUrl || '(unknown)'}`);
  lines.push(`Date:   ${new Date().toLocaleString('he-IL')}`);
  lines.push(`Found:  ${data.recordings.length} recordings`);
  lines.push('');

  if (data.error) {
    lines.push('שגיאה בסריקה: ' + data.error);
    lines.push('');
  }

  if (!data.recordings.length) {
    lines.push('-- לא נמצאו הקלטות --');
    lines.push('');
    lines.push('סטטיסטיקות סריקה:');
    lines.push(`  טבלאות בדף: ${data.debug.tables ?? '?'}`);
    lines.push(`  סך השורות שנסרקו: ${data.debug.totalRows ?? '?'}`);
    lines.push(`  שורות שזוהו כמועמדות: ${data.debug.candidateRows ?? 0}`);
    lines.push(`  iframes שנסרקו: ${data.frames}`);
    lines.push('');
    lines.push('דברים שכדאי לבדוק:');
    lines.push('1. ודא שאתה רואה את רשימת ההקלטות מולך לפני שתלחץ "סרוק".');
    lines.push('2. נסה לעבור בין "Upcoming" ל-"Previous" tabs ולחזור.');
    lines.push('3. ודא שהדף נפתח דרך פעילות מודל (LTI launch) ולא ישירות מ-URL.');
    if (data.debug.firstRowHTML) {
      lines.push('');
      lines.push('-- HTML של שורה ראשונה שנמצאה (לדיבאג) --');
      lines.push(data.debug.firstRowHTML);
    }
  } else {
    lines.push('=========================================================');
    for (let i = 0; i < data.recordings.length; i++) {
      const r = data.recordings[i];
      lines.push('');
      lines.push(`#${i + 1}. ${r.topic || '(no topic)'}`);
      if (r.meetingId) lines.push(`    Meeting ID: ${r.meetingId}`);
      if (r.date)      lines.push(`    Date:       ${r.date}`);
      if (r.duration)  lines.push(`    Duration:   ${r.duration}`);
      if (r.rawCells && r.rawCells.length) {
        lines.push(`    Raw:        ${r.rawCells.join(' | ')}`);
      }
    }
    lines.push('');
    lines.push('=========================================================');
    lines.push('');
    lines.push('הערה: באיטרציה הזו הקובץ מכיל רק מטא-דאטה (שם, תאריך, ID).');
    lines.push('כדי לצפות בכל הקלטה — פתח את הדף ב-Zoom ולחץ על השורה המתאימה.');
    lines.push('');
    lines.push('באיטרציה הבאה (3): התוסף יפתח כל הקלטה ויחלץ play-URL עם טוקן');
    lines.push('JWT שעובד מכל מכשיר ללא צורך בלוגין מחדש.');
  }

  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({
    url,
    filename: `zoom-recordings_${date}.txt`,
    saveAs: false,
  });
}
