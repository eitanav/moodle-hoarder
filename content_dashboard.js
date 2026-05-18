// content_dashboard.js
// Runs on the Moodle dashboard (/my/) — adds a "hide" button next to every
// item in the "ממתין לביצוע" timeline so the user can dismiss reopened
// submissions, irrelevant מילואים extensions, etc.
// State persists in chrome.storage.local under "hiddenDeadlines".

(function () {
  const STORAGE_KEY = 'hiddenDeadlines';
  let hidden = new Set();
  let showHidden = false;

  // ---- styles ----
  const STYLE = `
    .mh-row-controls {
      display: inline-flex;
      gap: 4px;
      margin: 0 8px;
      vertical-align: middle;
    }
    /* Moodle-Bootstrap-style primary button — blue, rounded, text label */
    .mh-btn {
      background: #0f6cbf;
      color: white;
      border: 1px solid #0f6cbf;
      border-radius: 6px;
      padding: 3px 12px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.4;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      font-family: inherit;
      white-space: nowrap;
      vertical-align: baseline;
    }
    .mh-btn:hover { background: #0a4f8a; border-color: #0a4f8a; }
    .mh-btn:focus { outline: 2px solid #5c9eff; outline-offset: 1px; }

    .mh-btn-unhide {
      background: #2e7d32;
      border-color: #2e7d32;
    }
    .mh-btn-unhide:hover { background: #1b5e20; border-color: #1b5e20; }

    .mh-row-truly-hidden { display: none !important; }
    .mh-row-revealed {
      opacity: 0.55;
      background: repeating-linear-gradient(45deg,
        transparent, transparent 8px,
        rgba(220, 40, 103, 0.06) 8px, rgba(220, 40, 103, 0.06) 16px);
    }

    .mh-toggle-bar {
      margin: 8px 0;
      padding: 8px 14px;
      background: linear-gradient(135deg, #ff8c3c, #dc2867);
      color: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      direction: rtl;
    }
    .mh-toggle-bar .mh-spacer { flex: 1; }
    .mh-toggle-bar .mh-bar-btn {
      background: rgba(255,255,255,0.18);
      border: 1px solid rgba(255,255,255,0.4);
      color: white;
      padding: 4px 12px;
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
      transition: background 0.15s;
    }
    .mh-toggle-bar .mh-bar-btn:hover { background: rgba(255,255,255,0.3); }
  `;

  function injectStyle() {
    if (document.getElementById('mh-dashboard-style')) return;
    const style = document.createElement('style');
    style.id = 'mh-dashboard-style';
    style.textContent = STYLE;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- storage ----
  async function loadHidden() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      hidden = new Set(stored[STORAGE_KEY] || []);
    } catch {}
  }
  async function saveHidden() {
    try { await chrome.storage.local.set({ [STORAGE_KEY]: [...hidden] }); } catch {}
  }

  // ---- row identification ----
  function getDeadlineId(row) {
    const link = row.querySelector('a[href*="/mod/"]');
    if (link?.href) {
      const m = link.href.match(/\/mod\/([a-z0-9_-]+)\/view\.php\?(?:[^#]*&)?id=(\d+)/i);
      if (m) return `${m[1]}:${m[2]}`;
      // some Moodle versions append &action=... — strip
      return link.href.split('?')[0] + '?' + (link.href.split('?')[1] || '').split('&')[0];
    }
    const titleEl = row.querySelector('h3, h4, h5, [class*="event-name"], [class*="event-title"], strong');
    const text = (titleEl?.textContent || row.textContent || '').trim();
    return 'text:' + text.slice(0, 80);
  }

  // ---- DOM hunting (covers Moodle 3.x and 4.x timeline layouts) ----
  function findDeadlineRows() {
    const selectors = [
      '[data-region="event-list-item"]',
      '[data-region="dashboard-timeline-event"]',
      '[data-region="upcoming-event-list-item"]',
      '.event-list-item',
      '.timeline-event-list-item',
      '[data-region="timeline-events"] li',
      '[data-region="event-list-content"] [data-region^="event"]',
    ];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length) return [...els];
    }
    return [];
  }

  // Walk up from the matched row until we find a wrapper that no longer
  // contains "another event next to us". That wrapper is the chunk we
  // should hide — Moodle 4.x typically wraps a single event together with
  // its date label, so hiding the wrapper makes the date vanish too.
  function getRowContainer(row) {
    let current = row;
    while (current.parentElement && current.parentElement.tagName !== 'BODY') {
      const parent = current.parentElement;
      const siblings = parent.querySelectorAll(
        '[data-region="event-list-item"], [data-region="dashboard-timeline-event"],' +
        ' [data-region="upcoming-event-list-item"], .event-list-item, .timeline-event-list-item'
      );
      // If parent contains ONLY this event, hide the parent (so the date label
      // attached to the day wrapper hides too). Stop as soon as a parent
      // contains another sibling event — we don't want to nuke unrelated rows.
      if (siblings.length === 1 && siblings[0] === row) {
        current = parent;
      } else {
        break;
      }
      // Safety: don't go above the timeline block itself.
      if (current.matches('[data-block="timeline"], .block_timeline, [data-region="timeline-events"]')) break;
    }
    return current;
  }

  function findTimelineHost() {
    return document.querySelector('[data-block="timeline"]')
        || document.querySelector('.block_timeline')
        || document.querySelector('[data-region="timeline-events"]')?.closest('[role="region"], section, .block, .card')
        || document.querySelector('[data-region="event-list-content"]')?.parentElement;
  }

  // ---- the title element to attach our button to ----
  function findRowAnchor(row) {
    return row.querySelector('h3, h4, h5, .event-name, [class*="event-name"], [class*="event-title"]')
        || row.querySelector('a[href*="/mod/"]')
        || row;
  }

  // ---- apply / unapply ----
  function applyRow(row) {
    if (row.dataset.mhProcessed === '1') return;
    row.dataset.mhProcessed = '1';
    const id = getDeadlineId(row);
    row.dataset.mhId = id;

    const anchor = findRowAnchor(row);
    if (!anchor) return;

    const btn = document.createElement('button');
    btn.className = 'mh-btn mh-hide-btn';
    btn.type = 'button';
    btn.textContent = 'הסתר';
    btn.title = 'הסתר מטלה זו (Moodle Hoarder)';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (hidden.has(id)) hidden.delete(id);
      else hidden.add(id);
      await saveHidden();
      applyVisibility();
      renderToggleBar();
    });

    const wrap = document.createElement('span');
    wrap.className = 'mh-row-controls';
    wrap.appendChild(btn);
    anchor.appendChild(wrap);
  }

  function applyVisibility() {
    for (const row of findDeadlineRows()) {
      const id = row.dataset.mhId || getDeadlineId(row);
      const isHidden = hidden.has(id);
      const btn = row.querySelector('.mh-hide-btn, .mh-btn-unhide');
      // Hide the container (which usually includes the date label too),
      // not just the row. Even when revealing, toggle classes on the
      // SAME container so the toggle bar's "הצג מוסתרות" actually flips state.
      const container = getRowContainer(row);

      if (isHidden) {
        if (showHidden) {
          container.classList.add('mh-row-revealed');
          container.classList.remove('mh-row-truly-hidden');
          if (btn) {
            btn.classList.remove('mh-hide-btn');
            btn.classList.add('mh-btn-unhide');
            btn.textContent = 'החזר';
            btn.title = 'החזר מטלה זו לרשימה';
          }
        } else {
          container.classList.add('mh-row-truly-hidden');
          container.classList.remove('mh-row-revealed');
        }
      } else {
        container.classList.remove('mh-row-revealed', 'mh-row-truly-hidden');
        if (btn) {
          btn.classList.remove('mh-btn-unhide');
          btn.classList.add('mh-hide-btn');
          btn.textContent = 'הסתר';
          btn.title = 'הסתר מטלה זו (Moodle Hoarder)';
        }
      }
    }
  }

  function renderToggleBar() {
    let bar = document.getElementById('mh-hidden-toggle-bar');
    const host = findTimelineHost();

    // No hidden items → no bar
    if (hidden.size === 0) {
      if (bar) bar.remove();
      return;
    }
    if (!host) return;

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mh-hidden-toggle-bar';
      bar.className = 'mh-toggle-bar';
      // Try to insert after the block title and before the event list.
      const eventList = host.querySelector('[data-region="event-list-content"], [data-region="timeline-events"]');
      if (eventList) eventList.parentElement.insertBefore(bar, eventList);
      else host.insertBefore(bar, host.firstChild);
    }

    bar.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = `${hidden.size} מטלות מוסתרות`;
    bar.appendChild(label);
    const spacer = document.createElement('span');
    spacer.className = 'mh-spacer';
    bar.appendChild(spacer);

    const showBtn = document.createElement('button');
    showBtn.type = 'button';
    showBtn.className = 'mh-bar-btn';
    showBtn.textContent = showHidden ? 'הסתר שוב' : 'הצג מוסתרות';
    showBtn.addEventListener('click', () => {
      showHidden = !showHidden;
      applyVisibility();
      renderToggleBar();
    });
    bar.appendChild(showBtn);

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'mh-bar-btn';
    clearBtn.textContent = 'בטל הכל';
    clearBtn.addEventListener('click', async () => {
      if (!confirm('להציג שוב את כל המטלות המוסתרות?')) return;
      hidden.clear();
      await saveHidden();
      applyVisibility();
      renderToggleBar();
    });
    bar.appendChild(clearBtn);
  }

  // ---- main loop ----
  function process() {
    const rows = findDeadlineRows();
    rows.forEach(applyRow);
    applyVisibility();
    renderToggleBar();
  }

  let scheduleTimer = null;
  function scheduleProcess() {
    clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(process, 120);
  }

  async function init() {
    injectStyle();
    await loadHidden();
    process();

    // Moodle's timeline lazy-loads & re-renders on filter changes. Watch for it.
    const obs = new MutationObserver(scheduleProcess);
    obs.observe(document.body, { childList: true, subtree: true });

    // Cross-tab sync — if another tab updated the hidden set, react.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEY]) {
        hidden = new Set(changes[STORAGE_KEY].newValue || []);
        applyVisibility();
        renderToggleBar();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
