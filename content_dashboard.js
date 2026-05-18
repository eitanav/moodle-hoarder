// content_dashboard.js — Moodle Hoarder
// Runs on /my/. Adds a "הסתר" button next to each timeline deadline so the
// user can dismiss assignments they don't need (resubmitted bins, מילואים
// extensions, etc.). Hidden set persists in chrome.storage.local under
// "hiddenDeadlines" and is shared with popup.js (which uses it to filter
// the ICS export view).
//
// The previous version used CSS classes for hide/reveal — but Moodle's React
// re-render and class-specificity issues made it flaky on the production
// dashboard. This version writes inline styles directly (which trump any
// class rule) and tracks the container element via a data attribute so the
// row-button and the container can be different DOM nodes (needed because
// the date label often sits in a sibling/ancestor, not inside the event row).

(function () {
  const STORAGE_KEY = 'hiddenDeadlines';
  const EVENT_SEL =
    '[data-region="event-list-item"], [data-region="dashboard-timeline-event"],' +
    ' [data-region="upcoming-event-list-item"], .event-list-item, .timeline-event-list-item';
  const TIMELINE_ROOT_SEL =
    '[data-block="timeline"], .block_timeline, [data-region="timeline-events"],' +
    ' [data-region="event-list-content"]';
  const DATE_RE = /\d{1,2}\/\d{1,2}\/\d{4}/;
  const REVEAL_STYLE = {
    opacity: '0.55',
    background:
      'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(220, 40, 103, 0.06) 8px, rgba(220, 40, 103, 0.06) 16px)',
  };

  let hidden = new Set();
  let showHidden = false;

  // ---- one-time CSS for the buttons + toggle bar ----
  function injectStyle() {
    if (document.getElementById('mh-dashboard-style')) return;
    const style = document.createElement('style');
    style.id = 'mh-dashboard-style';
    style.textContent = `
      .mh-row-controls {
        display: inline-flex;
        gap: 4px;
        margin: 0 8px;
        vertical-align: middle;
      }
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
      .mh-btn-unhide { background: #2e7d32; border-color: #2e7d32; }
      .mh-btn-unhide:hover { background: #1b5e20; border-color: #1b5e20; }

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

  // ---- row identity (stable across page reloads) ----
  function getDeadlineId(row) {
    const link = row.querySelector('a[href*="/mod/"]');
    if (link?.href) {
      const m = link.href.match(/\/mod\/([a-z0-9_-]+)\/view\.php\?(?:[^#]*&)?id=(\d+)/i);
      if (m) return `${m[1]}:${m[2]}`;
      return link.href.split('?')[0] + '?' + (link.href.split('?')[1] || '').split('&')[0];
    }
    const titleEl = row.querySelector('h3, h4, h5, [class*="event-name"], [class*="event-title"], strong');
    const text = (titleEl?.textContent || row.textContent || '').trim();
    return 'text:' + text.slice(0, 80);
  }

  function findDeadlineRows() {
    return [...document.querySelectorAll(EVENT_SEL)];
  }

  function findTimelineHost() {
    return document.querySelector('[data-block="timeline"]')
        || document.querySelector('.block_timeline')
        || document.querySelector('[data-region="timeline-events"]')?.closest('[role="region"], section, .block, .card')
        || document.querySelector('[data-region="event-list-content"]')?.parentElement;
  }

  function findRowAnchor(row) {
    return row.querySelector('h3, h4, h5, .event-name, [class*="event-name"], [class*="event-title"]')
        || row.querySelector('a[href*="/mod/"]')
        || row;
  }

  // ---- the heart of "make the date disappear too" ----
  // Walk up while the parent contains only this single event.  Then check
  // whether the chosen container actually carries a date in its text — if
  // not, the date is probably in a sibling label that needs hiding too.
  // Returns an ARRAY of elements to hide.
  function getHidingTargets(row) {
    let current = row;
    while (current.parentElement && current.parentElement !== document.body) {
      const parent = current.parentElement;
      const others = [...parent.querySelectorAll(EVENT_SEL)].filter(e => e !== row);
      if (others.length > 0) break;
      current = parent;
      if (current.matches(TIMELINE_ROOT_SEL)) break;
    }

    const targets = [current];

    // Date already inside the wrapper? we're done.
    if (DATE_RE.test(current.textContent || '')) return targets;

    // Otherwise look at sibling labels (and one more parent level up) for
    // a short date-only chunk.
    let sib = current.previousElementSibling;
    let hops = 0;
    while (sib && hops < 3) {
      const t = (sib.textContent || '').trim();
      if (t && t.length < 80 && DATE_RE.test(t)) { targets.unshift(sib); break; }
      // stop if the sibling itself is another event
      if (sib.matches(EVENT_SEL) || sib.querySelector(EVENT_SEL)) break;
      sib = sib.previousElementSibling;
      hops++;
    }

    return targets;
  }

  // ---- apply / visibility ----
  function applyRow(row) {
    if (row.dataset.mhProcessed === '1') return;
    row.dataset.mhProcessed = '1';
    const id = getDeadlineId(row);
    row.dataset.mhId = id;

    // Tag the elements we'll be hiding so applyVisibility can find them
    // even when the row → container relationship spans siblings.
    const targets = getHidingTargets(row);
    for (const t of targets) {
      const list = (t.getAttribute('data-mh-hides') || '').split(',').filter(Boolean);
      if (!list.includes(id)) list.push(id);
      t.setAttribute('data-mh-hides', list.join(','));
    }

    const anchor = findRowAnchor(row);
    if (!anchor) return;

    const btn = document.createElement('button');
    btn.className = 'mh-btn mh-hide-btn';
    btn.dataset.mhBtnFor = id;
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
    // For every tagged element, decide whether to hide / reveal / clear.
    for (const el of document.querySelectorAll('[data-mh-hides]')) {
      const ids = (el.getAttribute('data-mh-hides') || '').split(',').filter(Boolean);
      // The element should hide if ANY of the ids it represents is currently hidden.
      const anyHidden = ids.some(id => hidden.has(id));
      if (anyHidden && !showHidden) {
        el.style.setProperty('display', 'none', 'important');
        el.style.removeProperty('opacity');
        el.style.removeProperty('background');
      } else if (anyHidden && showHidden) {
        el.style.removeProperty('display');
        el.style.setProperty('opacity', REVEAL_STYLE.opacity, 'important');
        el.style.setProperty('background', REVEAL_STYLE.background, 'important');
      } else {
        el.style.removeProperty('display');
        el.style.removeProperty('opacity');
        el.style.removeProperty('background');
      }
    }
    // And update each button label.
    for (const btn of document.querySelectorAll('.mh-btn[data-mh-btn-for]')) {
      const id = btn.dataset.mhBtnFor;
      const isH = hidden.has(id);
      if (isH && showHidden) {
        btn.classList.remove('mh-hide-btn');
        btn.classList.add('mh-btn-unhide');
        btn.textContent = 'החזר';
        btn.title = 'החזר מטלה זו לרשימה';
      } else {
        btn.classList.remove('mh-btn-unhide');
        btn.classList.add('mh-hide-btn');
        btn.textContent = 'הסתר';
        btn.title = 'הסתר מטלה זו (Moodle Hoarder)';
      }
    }
  }

  function renderToggleBar() {
    let bar = document.getElementById('mh-hidden-toggle-bar');
    const host = findTimelineHost();

    if (hidden.size === 0) {
      if (bar) bar.remove();
      showHidden = false;
      return;
    }
    if (!host) return;

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'mh-hidden-toggle-bar';
      bar.className = 'mh-toggle-bar';
      const eventList = host.querySelector('[data-region="event-list-content"], [data-region="timeline-events"]');
      if (eventList) eventList.parentElement.insertBefore(bar, eventList);
      else host.insertBefore(bar, host.firstChild);
    }

    bar.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = `${hidden.size} מטלות מוסתרות`;
    bar.appendChild(label);
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    const showBtn = document.createElement('button');
    showBtn.type = 'button';
    showBtn.className = 'mh-bar-btn';
    showBtn.textContent = showHidden ? 'הסתר שוב' : 'הצג מוסתרות';
    showBtn.addEventListener('click', () => {
      showHidden = !showHidden;
      applyVisibility();
      // Re-render bar AFTER the click event finishes, so destroying the
      // button mid-handler doesn't confuse Chrome's event dispatch (this
      // was the flickering the user saw).
      setTimeout(renderToggleBar, 0);
    });
    bar.appendChild(showBtn);

    // No more "בטל הכל" bulk-undo button. Per-item ↺ (החזר) buttons appear
    // automatically when showHidden is on, so the user undoes selectively.
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

    const obs = new MutationObserver(scheduleProcess);
    obs.observe(document.body, { childList: true, subtree: true });

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
