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
let zoomScanned = null;    // zoom: { data: { recordings, pages, pageUrl }, tabId }

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
  const zoomView = document.getElementById('zoomPicker');
  if (zoomView) zoomView.style.display = name === 'zoom' ? 'block' : 'none';
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
      const data = await scrapeAllZoomPages(tab.id, (s) => setStatus(s));
      if (data.recordings.length === 0) {
        await saveZoomFile(data);
        setStatus('לא נמצאו הקלטות. ראה את הקובץ שירד לפרטים.');
        $('scan').disabled = false;
        return;
      }
      zoomScanned = { data, tabId: tab.id };
      renderZoomPicker();
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
    if (items.length) {
      const sIdx = sections.length;
      for (const it of items) it.sectionIdx = sIdx;
      sections.push({ name: sName, items });
    }
  }

  if (!sections.length) {
    // Fallback: no section structure detected → one bucket
    const all = collect(doc.body || doc, 'כללי');
    if (all.length) {
      for (const it of all) it.sectionIdx = 0;
      sections.push({ name: 'כללי', items: all });
    }
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

// ========== Zoom picker (after scrape, before URL resolution) ==========
function renderZoomPicker() {
  showView('zoom');
  const list = $('zoomItems');
  list.innerHTML = '';
  const recs = zoomScanned.data.recordings;
  $('totZoom').textContent = recs.length;
  for (const rec of recs) {
    const li = document.createElement('li');
    li.dataset.id = `${rec.meetingId || ''}|${rec.date || ''}|${(rec.topic || '').slice(0, 30)}`;
    const dateShort = (rec.date || '').slice(0, 22);
    const pageTag = zoomScanned.data.pages > 1 ? ` · p${rec.page}` : '';
    li.innerHTML = `
      <input type="checkbox" checked>
      <div style="flex:1;overflow:hidden;">
        <div class="name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
        <div class="id"></div>
      </div>`;
    li.querySelector('.name').textContent = rec.topic || '(ללא שם)';
    li.querySelector('.id').textContent = `${dateShort}${pageTag}`;
    li.querySelector('input').addEventListener('change', updateZoomCount);
    list.appendChild(li);
  }
  updateZoomCount();
  setStatus('');
}
function updateZoomCount() {
  const n = $('zoomItems').querySelectorAll('input[type=checkbox]:checked').length;
  $('selZoom').textContent = n;
  $('downloadZoom').disabled = n === 0;
}
$('zoomAll').addEventListener('click', () => {
  $('zoomItems').querySelectorAll('li:not([style*="display: none"]) input').forEach(c => c.checked = true);
  updateZoomCount();
});
$('zoomNone').addEventListener('click', () => {
  $('zoomItems').querySelectorAll('li:not([style*="display: none"]) input').forEach(c => c.checked = false);
  updateZoomCount();
});
$('searchZoom').addEventListener('input', () => {
  const q = $('searchZoom').value.toLowerCase().trim();
  $('zoomItems').querySelectorAll('li').forEach(li => {
    const t = li.querySelector('.name').textContent.toLowerCase()
            + ' ' + li.querySelector('.id').textContent.toLowerCase();
    li.style.display = (q && !t.includes(q)) ? 'none' : '';
  });
});
$('backZoom').addEventListener('click', () => {
  showView('initial');
  $('scan').disabled = false;
  resetFooter();
  zoomScanned = null;
});

$('downloadZoom').addEventListener('click', async () => {
  if (!zoomScanned) return;
  $('downloadZoom').disabled = true;
  $('backZoom').disabled = true;
  const allRecs = zoomScanned.data.recordings;
  const checkedIds = new Set();
  $('zoomItems').querySelectorAll('li').forEach(li => {
    if (li.querySelector('input').checked) checkedIds.add(li.dataset.id);
  });
  const selected = allRecs.filter(r =>
    checkedIds.has(`${r.meetingId || ''}|${r.date || ''}|${(r.topic || '').slice(0, 30)}`));
  if (!selected.length) { $('backZoom').disabled = false; return; }

  setStatus(`מתחיל פענוח קישורים ל-${selected.length} הקלטות — אל תסגור!`);
  const debugHtml = await resolveZoomPlayUrls(zoomScanned.tabId, selected, (s) => setStatus(s));

  // Output file contains only the selected recordings
  const outData = { ...zoomScanned.data, recordings: selected };
  await saveZoomFile(outData);
  const ok = selected.filter(r => r.shareUrls?.length).length;
  if (ok === 0 && debugHtml) {
    const date = new Date().toISOString().slice(0, 10);
    const dumpBlob = new Blob([
      `<!-- Source URL: ${debugHtml.sourceUrl} -->\n<!-- Captured: ${new Date().toISOString()} -->\n`,
      debugHtml.html,
    ], { type: 'text/html;charset=utf-8' });
    await chrome.downloads.download({
      url: URL.createObjectURL(dumpBlob),
      filename: `zoom-detail-debug_${date}.html`,
      saveAs: false,
    });
    setStatus(`לא נמצאו URLs. הורד גם zoom-detail-debug HTML.`);
  } else {
    setStatus(`הושלם: ${ok}/${selected.length} קישורים נמצאו.`);
  }
  notify('Moodle Hoarder', `Zoom: ${ok}/${selected.length} קישורים נחלצו`);
  $('backZoom').disabled = false;
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

// Max items being downloaded concurrently. Tuned so Moodle doesn't rate-limit
// us — each fetchItem can itself fan out (folder/assign/page handlers fetch
// multiple files), so effective parallelism is higher.
const CONCURRENT_DOWNLOADS = 5;

// Fetch every item in parallel with a concurrency cap. Results array stays in
// original order so the ZIP and log don't reshuffle.
async function fetchItemsParallel(items, concurrency, onProgress) {
  const results = new Array(items.length);
  const errors = [];
  let nextIdx = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      const item = items[i];
      try {
        results[i] = await fetchItem(item);
      } catch (e) {
        errors.push({ item, err: e.message || String(e) });
        results[i] = null;
      } finally {
        completed++;
        onProgress?.(completed, items.length, item);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return { results, errors };
}

// ========== Core download routine ==========
async function runDownload({ courseName, courseId, courseUrl, items, silent }) {
  if (!silent) logEl.innerHTML = '';
  setProgress(0, items.length);

  const files = [];
  const links = [];      // generic URL activities
  const recordings = []; // streaming
  const events = [];     // calendar deadlines
  const used = new Set();

  // Phase 1: parallel fetch
  setStatus(`מוריד ${items.length} פריטים במקביל (עד ${CONCURRENT_DOWNLOADS} בו-זמנית)...`);
  const { results, errors } = await fetchItemsParallel(items, CONCURRENT_DOWNLOADS,
    (done, total, item) => {
      setStatus(`(${done}/${total}) הושלם: ${item.name}`);
      setProgress(done, total);
    });

  if (!silent) {
    for (const { item, err } of errors) logLine(`✗ ${item.name}: ${err}`, 'err');
  }

  // Phase 2: assemble paths in original order (so the ZIP and log are stable)
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const got = results[i];
    if (!got) continue;
    for (const r of got) {
      if (r.kind === 'recording') recordings.push(r);
      else if (r.kind === 'link') links.push(r);
      else if (r.kind === 'event') events.push(r.event);
      else {
        // Each downloaded file goes into two places in the ZIP:
        // 1) sections/<NN - section name>/<internal path>  — mirror of Moodle's section layout
        // 2) "00 - כל הקבצים"/<filename>                   — single flat folder with everything
        const sectionIdx = item.sectionIdx ?? 0;
        const sectionNum = String(sectionIdx + 1).padStart(2, '0');
        const sectionName = sanitizeFilename(item.section || 'כללי') || 'כללי';
        const sectionPath = uniquePath(used, `${sectionNum} - ${sectionName}/${r.path}`);
        files.push({ path: sectionPath, blob: r.blob });
        if (!silent) logLine(`✓ ${sectionPath} (${formatSize(r.blob.size)})`, 'ok');

        const filename = r.path.split('/').pop();
        const isSubmission = r.path.includes('/_הגשות שלי/');
        const flatRel = isSubmission ? `_הגשות שלי/${filename}` : filename;
        const flatPath = uniquePath(used, `00 - כל הקבצים/${flatRel}`);
        files.push({ path: flatPath, blob: r.blob });
      }
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
      return [{ path: fn, blob }];
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
      out.push({ path: `${folder}/${fn}`, blob });
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
      out.push({ path: `${folder}/${fn}`, blob });
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
      out.push({ path: `${folder}/_הגשות שלי/${fn}`, blob });
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
        return [{ path: fn, blob }];
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
      out.push({ path: `${folder}/${fn}`, blob });
    } catch {}
  }
  if (content.textContent.trim()) {
    const wrapped = `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>${escapeHtml(item.name)}</title><style>body{font-family:Segoe UI,Arial,sans-serif;max-width:780px;margin:24px auto;padding:0 16px;line-height:1.6}@media print{body{margin:0}}</style>${content.outerHTML}`;
    out.push({ path: `${folder}/index.html`, blob: new Blob([wrapped], { type: 'text/html;charset=utf-8' }) });
  }
  return out;
}

async function fetchBook(item) {
  const res = await fetch(item.url, { credentials: 'include' });
  const html = await res.text();
  return [{ path: `${sanitizeFilename(item.name)}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) }];
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
  // Duration: "1h 30m" / "45m" / "1 hr 30 min" (require word-boundary + space, to avoid catching meeting ID digits)
  const DUR_RE = /(?:^|\s)(\d{1,2}\s*(?:hr|hrs|hours|h)(?:\s*\d{1,2}\s*(?:min|mins|m))?|\d{1,3}\s*(?:min|mins|minutes)|\d{1,2}\s*(?:שעות|שעה)(?:\s*\d{1,2}\s*דקות)?|\d{1,3}\s*דקות)(?=\s|$)/i;

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
        if (durMatch && t.trim() === (durMatch[1] || durMatch[0]).trim()) continue;
        if (/^\s*$/.test(t)) continue;
        topic = t;
        break;
      }
      if (!topic) topic = cellTexts[0] || '';
      recordings.push({
        topic,
        meetingId: idMatch ? idMatch[0].replace(/\s+/g, '') : '',
        date: dateMatch ? dateMatch[0] : '',
        duration: durMatch ? (durMatch[1] || durMatch[0]).trim() : '',
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
  lines.push(`Found:  ${data.recordings.length} recordings${data.pages > 1 ? ` (across ${data.pages} pages)` : ''}`);
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
      if (r.page && data.pages > 1) lines.push(`    Page:       ${r.page}`);
      if (r.shareUrls && r.shareUrls.length) {
        if (r.shareUrls.length === 1) {
          lines.push(`    URL:        ${r.shareUrls[0]}`);
        } else {
          lines.push(`    URLs:`);
          for (const u of r.shareUrls) lines.push(`        ${u}`);
        }
      }
      if (r.error) lines.push(`    ⚠ Error:    ${r.error}`);
      if (r.rawCells && r.rawCells.length && !r.shareUrls?.length) {
        lines.push(`    Raw:        ${r.rawCells.join(' | ')}`);
      }
    }
    lines.push('');
    lines.push('=========================================================');
    lines.push('');
    const withUrls = data.recordings.filter(r => r.shareUrls?.length).length;
    if (withUrls > 0) {
      lines.push(`נמצאו קישורים ל-${withUrls} מתוך ${data.recordings.length} הקלטות.`);
      lines.push('');
      lines.push('הקישורים הם share-URLs — לחיצה תפתח דף שעושה אימות ומפנה');
      lines.push('ל-play-URL עם טוקן ה-tk. אם רוצים URL שעובד מכל מכשיר ללא');
      lines.push('לוגין, פתחו את הקישור, חכו שהנגן ייטען, והעתיקו את הכתובת');
      lines.push('מסרגל הכתובות אז.');
    } else {
      lines.push('לא נמצאו קישורים בדפי ה-detail.');
      lines.push('שלח HTML של דף detail אחד (אחרי קליק על הקלטה) להמשך טיפול.');
    }
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

// ===== Pagination =====
// Walk through all pages of the Zoom recordings table. Clicks "Next", waits
// for rows to render, dedupes across pages. Stops when no new rows arrive
// or no Next button is found.
async function scrapeAllZoomPages(tabId, onProgress) {
  const all = [];
  const debug = {};
  const seen = new Set();
  let pageNum = 1;
  const MAX = 50;
  let pageUrl = '';

  while (pageNum <= MAX) {
    onProgress?.(`(עמוד ${pageNum}) ממתין שיטענו השורות...`);
    await waitForZoomList(tabId);
    onProgress?.(`(עמוד ${pageNum}) סורק...`);
    const data = await extractZoomRecordings(tabId);
    if (data.pageUrl) pageUrl = data.pageUrl;
    Object.assign(debug, data.debug || {});

    let added = 0;
    for (const r of data.recordings) {
      const key = (r.meetingId || '') + '|' + (r.date || '') + '|' + (r.topic || '').slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...r, page: pageNum });
      added++;
    }
    onProgress?.(`(עמוד ${pageNum}) ${added} חדשים, סה"כ ${all.length}`);

    // If first page returned nothing useful, stop (the page isn't a recordings list)
    if (pageNum === 1 && all.length === 0) break;
    // If this page added nothing, we've already seen everything → done
    if (added === 0 && pageNum > 1) break;

    onProgress?.(`(עמוד ${pageNum}) מעבר לעמוד הבא...`);
    const advanced = await clickZoomNextPage(tabId);
    if (!advanced) break;
    // Give SPA time to swap rows, then waitForZoomList will confirm
    await new Promise(r => setTimeout(r, 800));
    pageNum++;
  }

  return { pageUrl, recordings: all, debug, frames: 0, pages: pageNum };
}

// Try several Next-button patterns, return true if we clicked one.
async function clickZoomNextPage(tabId) {
  let clickedAny = false;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const isDisabled = (el) => {
          if (!el) return true;
          if (el.disabled) return true;
          if (el.getAttribute('aria-disabled') === 'true') return true;
          const cls = (el.className || '').toString();
          if (/\b(is-)?disabled\b/i.test(cls)) return true;
          // Parent might carry the disabled state
          const parent = el.closest('[aria-disabled="true"], .disabled, .is-disabled');
          if (parent && parent !== document.body) return true;
          return false;
        };
        // Selector candidates ordered by specificity
        const selectors = [
          // Ant Design pagination (used by Zoom LTI)
          'li.ant-pagination-next:not(.ant-pagination-disabled) a',
          'li.ant-pagination-next:not(.ant-pagination-disabled)',
          '.ant-pagination-next:not(.ant-pagination-disabled)',
          'button[aria-label*="Next page" i]',
          'button[aria-label*="next" i]',
          'a[aria-label*="Next page" i]',
          'a[aria-label*="next" i]',
          '.zm-pagination__next',
          '[class*="pagination"] [class*="next"]:not([class*="disabled"])',
          'li.next:not(.disabled) a',
          'li.next:not(.disabled) button',
          '.pagination-next',
          '[data-testid*="next" i]',
        ];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            if (isDisabled(el)) continue;
            el.click();
            return { clicked: true, via: sel };
          }
        }
        // Text-based fallback: "Next" / "הבא" / chevrons
        const textCandidates = ['next', 'הבא', '›', '»', '>'];
        for (const el of document.querySelectorAll('button, a, [role="button"]')) {
          if (isDisabled(el)) continue;
          const t = (el.textContent || '').trim().toLowerCase();
          if (textCandidates.includes(t)) {
            el.click();
            return { clicked: true, via: 'text:' + t };
          }
        }
        return { clicked: false };
      },
    });
    clickedAny = results.some(r => r?.result?.clicked);
  } catch {}
  return clickedAny;
}

// Same as clickZoomNextPage but for Previous.
async function clickZoomPrevPage(tabId) {
  let clickedAny = false;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const isDisabled = (el) => {
          if (!el) return true;
          if (el.disabled) return true;
          if (el.getAttribute('aria-disabled') === 'true') return true;
          const cls = (el.className || '').toString();
          if (/\b(is-)?disabled\b/i.test(cls)) return true;
          const parent = el.closest('[aria-disabled="true"], .disabled, .is-disabled');
          if (parent && parent !== document.body) return true;
          return false;
        };
        const selectors = [
          // Ant Design pagination
          'li.ant-pagination-prev:not(.ant-pagination-disabled) a',
          'li.ant-pagination-prev:not(.ant-pagination-disabled)',
          '.ant-pagination-prev:not(.ant-pagination-disabled)',
          'button[aria-label*="Previous page" i]',
          'button[aria-label*="previous" i]',
          'a[aria-label*="previous" i]',
          '.zm-pagination__prev',
          '[class*="pagination"] [class*="prev"]:not([class*="disabled"])',
          'li.prev:not(.disabled) a',
          'li.prev:not(.disabled) button',
          '.pagination-prev',
          '[data-testid*="prev" i]',
        ];
        for (const sel of selectors) {
          for (const el of document.querySelectorAll(sel)) {
            if (isDisabled(el)) continue;
            el.click();
            return true;
          }
        }
        const texts = ['previous', 'prev', 'הקודם', '‹', '«', '<'];
        for (const el of document.querySelectorAll('button, a, [role="button"]')) {
          if (isDisabled(el)) continue;
          const t = (el.textContent || '').trim().toLowerCase();
          if (texts.includes(t)) { el.click(); return true; }
        }
        return false;
      },
    });
    clickedAny = results.some(r => r?.result);
  } catch {}
  return clickedAny;
}

// ===== URL resolution (iteration 5) =====
// For each recording (in display order across pages), simulate a click on its
// table row, wait for the detail page to render, collect every /rec/share|play|download
// URL we can find, then navigate back. Processes from last page backwards so we
// don't need to find a "go to first page" button.
async function resolveZoomPlayUrls(tabId, recordings, onProgress) {
  for (const rec of recordings) {
    rec.shareUrls = [];
    rec.detailUrl = '';
    rec.error = null;
  }

  const totalPages = Math.max(1, ...recordings.map(r => r.page || 1));
  let recDone = 0;
  let debugHtml = null;
  // After scraping pagination we're on the last page. We don't actually
  // need to know that — every page iteration starts with an explicit
  // navigation to the target page number.
  let currentPage = null;

  for (let p = 1; p <= totalPages; p++) {
    const onPage = recordings.filter(r => (r.page || 1) === p);
    if (!onPage.length) continue;

    onProgress?.(`מעבר לעמוד ${p}...`);
    currentPage = await navigateToZoomPage(tabId, p, currentPage ?? totalPages);
    if (currentPage !== p) {
      // Couldn't get to the target page — mark all entries on it as such and skip.
      for (const rec of onPage) rec.error = `couldn't navigate to page ${p}`;
      continue;
    }
    await waitForZoomList(tabId);

    for (let i = 0; i < onPage.length; i++) {
      const rec = onPage[i];
      recDone++;
      const short = (rec.date || '').slice(0, 12);
      onProgress?.(`(${recDone}/${recordings.length}) [עמוד ${p}] ${rec.topic} — ${short}`);

      const clicked = await clickRecordingRow(tabId, i);
      if (!clicked) { rec.error = 'click failed'; continue; }

      const detail = await waitForDetailPage(tabId, 8000);
      rec.detailUrl = detail.url;
      rec.shareUrls = detail.urls;
      if (!rec.shareUrls.length) {
        const captured = await clickPlayAndCaptureUrl(tabId);
        if (captured.length) rec.shareUrls = captured;
        else rec.error = 'no URL on detail; play-button click captured nothing';
      }

      if (debugHtml === null) {
        const dump = await dumpCurrentPageHtml(tabId);
        if (dump?.html) debugHtml = { sourceUrl: dump.url || '', html: dump.html.slice(0, 800000) };
      }

      await navigateBackInZoom(tabId);
      const ok = await waitForListPage(tabId, 6000);
      if (!ok) rec.error = (rec.error ? rec.error + '; ' : '') + 'list did not restore';
    }
  }

  return debugHtml;
}

// Navigate to a specific page in the Zoom LTI pagination. Tries clicking the
// numbered item directly (Ant Design: .ant-pagination-item-N), then falls
// back to Next/Previous clicks one step at a time.
async function navigateToZoomPage(tabId, targetPage, currentPage) {
  if (currentPage === targetPage) return targetPage;

  // 1) Try direct click on the page number
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [targetPage],
      func: (n) => {
        // Already active? Done.
        const active = document.querySelector('.ant-pagination-item-active');
        if (active && active.classList.contains(`ant-pagination-item-${n}`)) return 'already';
        // Click the page item (or its inner anchor)
        const item = document.querySelector(`.ant-pagination-item-${n}`);
        if (item) {
          const inner = item.querySelector('a');
          (inner || item).click();
          return 'clicked';
        }
        return 'not-found';
      },
    });
    if (results.some(r => r?.result === 'already' || r?.result === 'clicked')) {
      await new Promise(r => setTimeout(r, 800));
      await waitForZoomList(tabId);
      return targetPage;
    }
  } catch {}

  // 2) Fall back to one-step clicks
  while (currentPage < targetPage) {
    const ok = await clickZoomNextPage(tabId);
    if (!ok) return currentPage;
    await new Promise(r => setTimeout(r, 800));
    await waitForZoomList(tabId);
    currentPage++;
  }
  while (currentPage > targetPage) {
    const ok = await clickZoomPrevPage(tabId);
    if (!ok) return currentPage;
    await new Promise(r => setTimeout(r, 800));
    await waitForZoomList(tabId);
    currentPage--;
  }
  return currentPage;
}

// Click the i'th row in the table that contains zoom meeting IDs.
async function clickRecordingRow(tabId, rowIdx) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      args: [rowIdx],
      func: (idx) => {
        const ZOOM_ID_RE = /\b\d{3,4}\s+\d{3,4}\s+\d{3,4}\b/;
        let target = null;
        for (const table of document.querySelectorAll('table')) {
          for (const row of table.querySelectorAll('tbody tr')) {
            if (ZOOM_ID_RE.test(row.textContent || '')) { target = table; break; }
          }
          if (target) break;
        }
        if (!target) return false;
        const rows = target.querySelectorAll('tbody tr');
        const row = rows[idx];
        if (!row) return false;
        // Prefer the topic link / explicit button
        const link = row.querySelector('a[href]:not([href="#"]):not([href^="javascript"])');
        if (link) { link.click(); return true; }
        const btn = row.querySelector('button:not([disabled]), [role="button"]');
        if (btn) { btn.click(); return true; }
        // React onClick on the row itself
        row.click();
        return true;
      },
    });
    return results.some(r => r?.result === true);
  } catch { return false; }
}

// Poll until any zoom recording URL appears on the page, or timeout.
// Broad matching: any zoom URL with rec|recording, any target=_blank link,
// any data-* attribute carrying a zoom URL.
async function waitForDetailPage(tabId, timeoutMs = 8000) {
  const start = Date.now();
  let detailUrl = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const REC_RE = /https?:\/\/[^\s"'<>]*zoom\.us\/[^\s"'<>?#]*(?:rec|recording)\/[^\s"'<>?#]+(?:\?[^\s"'<>#]*)?/g;
          const found = new Set();
          const isRecording = (u) => /zoom\.us\/(?:rec|recording)\//.test(u) || /\/recording\/(?:play|share|detail)/i.test(u);

          // Anchors with a recording-shaped href
          for (const a of document.querySelectorAll('a[href]')) {
            const href = a.href || '';
            if (isRecording(href)) found.add(href);
          }
          // Anchors that open in a new tab — Zoom uses these for play/download
          for (const a of document.querySelectorAll('a[target="_blank"][href]')) {
            const href = a.href || '';
            if (!href || href.startsWith('javascript:') || href.endsWith('#')) continue;
            // Tag with marker so we can spot in output
            if (/zoom\.us/.test(href) || /recording/i.test(href)) found.add(href);
            else found.add('[blank] ' + href);
          }
          // Input / textarea values (Zoom shows share URL in copyable input)
          for (const el of document.querySelectorAll('input, textarea')) {
            const v = (el.value ?? '').toString();
            const ms = v.match(REC_RE);
            if (ms) ms.forEach(u => found.add(u));
          }
          // Visible body text
          const txt = (document.body && document.body.innerText) || '';
          const tm = txt.match(REC_RE);
          if (tm) tm.forEach(u => found.add(u));
          // Any data-* attribute carrying a recording URL
          for (const el of document.querySelectorAll('*')) {
            for (const attr of el.attributes || []) {
              if (!attr.name.startsWith('data-')) continue;
              const v = attr.value || '';
              if (isRecording(v)) {
                found.add(v.startsWith('http') ? v : ('https:' + (v.startsWith('//') ? v : '//' + v.replace(/^\/+/, ''))));
              }
            }
          }
          // onclick handlers (as strings) with embedded URLs
          for (const el of document.querySelectorAll('[onclick]')) {
            const oc = el.getAttribute('onclick') || '';
            const ms = oc.match(REC_RE);
            if (ms) ms.forEach(u => found.add(u));
          }
          return { url: location.href, urls: [...found] };
        },
      });
      const all = new Set();
      for (const r of results) {
        if (!r?.result) continue;
        if (r.result.url && !detailUrl) detailUrl = r.result.url;
        for (const u of r.result.urls) all.add(u);
      }
      if (all.size > 0) return { url: detailUrl, urls: [...all] };
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  return { url: detailUrl, urls: [] };
}

// Capture the full body HTML of the current page (for debugging unknown layouts).
async function dumpCurrentPageHtml(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({
        url: location.href,
        html: (document.body && document.body.outerHTML) || '',
      }),
    });
    // Pick the largest payload (likely the detail content frame, not chrome)
    let best = null;
    for (const r of results) {
      if (!r?.result?.html) continue;
      if (!best || r.result.html.length > best.html.length) best = r.result;
    }
    return best;
  } catch { return null; }
}

// Navigate back from detail to list: prefer the Ant breadcrumb link Zoom uses,
// fall back to history.back().
async function navigateBackInZoom(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        // Zoom LTI uses Ant breadcrumbs: first .ant-breadcrumb-link contains a clickable span.
        const breadcrumb = document.querySelector('.ant-breadcrumb');
        if (breadcrumb) {
          // Find the first clickable link in the breadcrumb (typically "Course Recordings")
          const btn = breadcrumb.querySelector('[role="button"], a[href]:not([href="#"])');
          if (btn) { btn.click(); return; }
        }
        const sel = [
          '[aria-label*="back" i]',
          'button[class*="back" i]',
          '[class*="back-button" i]',
          '[class*="breadcrumb"] a:first-child',
          '[class*="breadcrumb"] [class*="link"]:first-child',
        ];
        for (const s of sel) {
          const el = document.querySelector(s);
          if (el && el.offsetParent !== null) { el.click(); return; }
        }
        history.back();
      },
    });
  } catch {}
  await new Promise(r => setTimeout(r, 600));
}

// On the recording detail page, click the play button (Zoom's
// `.lti-recording-item-play-media` span) and capture the URL Zoom tries to
// open via window.open. This runs in MAIN world so we can override the
// real window.open of the page.
async function clickPlayAndCaptureUrl(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: async () => {
        const origOpen = window.open;
        const captured = [];
        // Replace window.open with a capturer that returns a fake window so
        // Zoom's caller code doesn't choke on `.focus()`, `.postMessage()`, etc.
        const fakeWin = {
          closed: false,
          location: { href: '', replace() {}, assign(u) { captured.push(String(u)); } },
          close() { this.closed = true; },
          focus() {}, blur() {}, postMessage() {},
          document: { write() {}, writeln() {}, close() {} },
        };
        window.open = function (url) {
          if (url) captured.push(String(url));
          fakeWin.location.href = String(url || '');
          return fakeWin;
        };

        // Also intercept programmatic <a target="_blank"> clicks via createElement('a').click()
        const origClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.href && this.target === '_blank') {
            captured.push(this.href);
            return;
          }
          return origClick.apply(this, arguments);
        };

        const restore = () => {
          window.open = origOpen;
          HTMLAnchorElement.prototype.click = origClick;
        };

        try {
          const btn = document.querySelector('.lti-recording-item-play-media')
                   || document.querySelector('[class*="play-media"]')
                   || document.querySelector('[title="Play"]')
                   || document.querySelector('[aria-label*="play" i][role="button"]');
          if (!btn) { restore(); return { error: 'play button not found', captured: [] }; }
          btn.click();
          // Wait for async window.open call (Zoom may call an API first)
          await new Promise(r => setTimeout(r, 2500));
          restore();
          return { captured };
        } catch (e) {
          restore();
          return { error: String(e), captured };
        }
      },
    });
    const all = new Set();
    for (const r of results) {
      if (r?.result?.captured) for (const u of r.result.captured) if (u) all.add(u);
    }
    return [...all];
  } catch {
    return [];
  }
}

// Wait until the recordings table reappears with rows.
async function waitForListPage(tabId, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const ZOOM_ID_RE = /\b\d{3,4}\s+\d{3,4}\s+\d{3,4}\b/;
          for (const table of document.querySelectorAll('table')) {
            for (const row of table.querySelectorAll('tbody tr')) {
              if (ZOOM_ID_RE.test(row.textContent || '')) return true;
            }
          }
          return false;
        },
      });
      if (results.some(r => r?.result === true)) {
        await new Promise(r => setTimeout(r, 300));
        return true;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}
