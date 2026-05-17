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
      setStatus('סורק הקלטות Zoom...');
      const data = await extractZoomRecordings(tab.id);
      await saveZoomFile(data);
      const n = data.recordings.length + data.scripts.length;
      if (n === 0) {
        setStatus('לא נמצאו הקלטות. ראה את הקובץ שירד להוראות.');
      } else {
        setStatus(`הושלם: ${data.recordings.length} הקלטות (${data.scripts.length} מסקריפטים).`);
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

// ===================== Zoom recordings (iteration 1) =====================
// Strategy: scan the current tab (LTI page or any zoom.us page), collect any
// recording links + surrounding metadata, dump to a text file. Resolution
// of share URLs into play URLs (with the JWT token) is iteration 2.

async function extractZoomRecordings(tabId) {
  let results = [];
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scrapeZoomPage,
    });
  } catch (e) {
    return { pageUrl: '', recordings: [], scripts: [], frames: 0, error: e.message };
  }
  const out = { pageUrl: '', recordings: [], scripts: [], frames: results.length };
  for (const r of results) {
    if (!r?.result) continue;
    if (r.result.pageUrl && !out.pageUrl) out.pageUrl = r.result.pageUrl;
    out.recordings.push(...(r.result.recordings || []));
    out.scripts.push(...(r.result.scripts || []));
  }
  // Dedupe by URL
  const seen = new Set();
  out.recordings = out.recordings.filter(r => seen.has(r.url) ? false : (seen.add(r.url), true));
  out.scripts = [...new Set(out.scripts)];
  return out;
}

// Runs IN PAGE CONTEXT (no popup APIs available here)
function scrapeZoomPage() {
  const REC_URL_RE = /zoom\.us\/(?:rec\/(?:share|play|download)|recording)\/[^"'\s<>]*/i;
  const recordings = [];
  const push = (url, row) => {
    const text = row ? row.textContent.trim().replace(/\s+/g, ' ').slice(0, 400) : '';
    recordings.push({ url, text });
  };

  // 1) Direct anchors with rec/share or rec/play
  for (const a of document.querySelectorAll('a[href]')) {
    if (!REC_URL_RE.test(a.href)) continue;
    const row = a.closest('tr, [role="row"], .meeting-card, [class*="recording"], [class*="meeting"], li') || a.parentElement;
    push(a.href, row);
  }

  // 2) Table-row fallback: any row containing zoom links
  if (!recordings.length) {
    for (const row of document.querySelectorAll('table tr, [role="row"]')) {
      const links = [...row.querySelectorAll('a[href]')].filter(a => /zoom\.us/.test(a.href));
      for (const a of links) push(a.href, row);
    }
  }

  // 3) Any button / clickable with onclick referencing recordings
  for (const el of document.querySelectorAll('[onclick]')) {
    const oc = el.getAttribute('onclick') || '';
    const m = oc.match(REC_URL_RE);
    if (m) push('https://' + m[0].replace(/^https?:\/\//, ''), el.closest('tr, li, .meeting-card') || el);
  }

  // 4) Mine <script> tags for embedded URLs (React/Vue state often has them)
  const scriptUrls = [];
  const SCRIPT_URL_RE = /https?:\/\/[a-z0-9.-]*zoom\.us\/(?:rec\/(?:share|play|download)|recording)\/[^"'\s<>]+/ig;
  for (const s of document.querySelectorAll('script')) {
    const t = s.textContent || '';
    const matches = t.match(SCRIPT_URL_RE);
    if (matches) scriptUrls.push(...matches);
  }

  // 5) Mine HTML data-* attributes
  for (const el of document.querySelectorAll('[data-share-url], [data-recording-url], [data-play-url], [data-url]')) {
    const u = el.getAttribute('data-share-url') || el.getAttribute('data-recording-url')
           || el.getAttribute('data-play-url') || el.getAttribute('data-url') || '';
    if (REC_URL_RE.test(u)) push(u.startsWith('http') ? u : 'https://' + u.replace(/^\/+/, ''), el.closest('tr, li') || el);
  }

  return { pageUrl: location.href, recordings, scripts: scriptUrls };
}

async function saveZoomFile(data) {
  const lines = [];
  lines.push('Moodle Hoarder — Zoom Recordings');
  lines.push('================================');
  lines.push(`Source: ${data.pageUrl || '(unknown)'}`);
  lines.push(`Date:   ${new Date().toLocaleString('he-IL')}`);
  lines.push(`Frames scanned: ${data.frames}`);
  lines.push(`Recordings found: ${data.recordings.length}`);
  lines.push(`URLs from page scripts: ${data.scripts.length}`);
  lines.push('');

  if (data.error) {
    lines.push('שגיאה בסריקה: ' + data.error);
    lines.push('');
  }

  if (!data.recordings.length && !data.scripts.length) {
    lines.push('-- לא נמצאו הקלטות --');
    lines.push('');
    lines.push('בדיקות:');
    lines.push('1. ודא שאתה בדף הקלטות Zoom שנפתח דרך פעילות במודל (LTI).');
    lines.push('2. רענן והמתן שהרשימה תיטען לגמרי לפני סריקה.');
    lines.push('3. אם הדף מציג iframe (Zoom מוטמע בתוך מודל) — לעיתים צריך לפתוח את');
    lines.push('   הפעילות בחלון חדש (כפתור "Open in new window" של מודל).');
    lines.push('');
    lines.push('כל הקלטה שאתה רואה בדף אבל לא מופיעה כאן — צלם מסך / שלח HTML של השורה');
    lines.push('כדי שאוכל להוסיף את ה-selector המתאים באיטרציה הבאה.');
  } else {
    lines.push('-- Recordings --');
    lines.push('');
    for (const r of data.recordings) {
      lines.push(r.text || '(no metadata)');
      lines.push(r.url);
      lines.push('');
    }
    if (data.scripts.length) {
      lines.push('-- Extra URLs found in page scripts --');
      for (const u of data.scripts) lines.push(u);
      lines.push('');
    }
    lines.push('');
    lines.push('הערה: הקישורים האלו הם share-URLs ויידרשו אימות כשתפתח אותם.');
    lines.push('באיטרציה הבאה התוסף ייפתח כל אחד בטאב נסתר וייצור play-URLs עם טוקן');
    lines.push('שעובד מכל מכשיר ללא לוגין.');
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
