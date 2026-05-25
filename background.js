// Context-menu: right-click any link on Moodle/Ariel → hoard it.
// The visible menu items now follow settings.rightClickBehavior:
//   'immediate' → one item: "הורד עם Moodle Hoarder"  (downloads now)
//   'queue'     → one item: "הוסף לתור Moodle Hoarder" (always queues)
//   'ask'       → two items: download-now + add-to-queue (user picks each time)

importScripts('settings.js');

const QUEUE_KEY = 'rightClickQueue';
const PATTERNS = ['*://moodlearn.ariel.ac.il/*', '*://*.ariel.ac.il/*'];

async function rebuildContextMenus() {
  const settings = await getSettings();
  const behavior = settings.rightClickBehavior || 'immediate';
  await new Promise(res => chrome.contextMenus.removeAll(res));

  // 'hoard-link' = the primary item; behavior decided by `behavior`
  // 'hoard-link-queue' = explicit queue (only shown for 'ask' mode)
  if (behavior === 'queue') {
    chrome.contextMenus.create({
      id: 'hoard-link',
      title: 'הוסף לתור Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: PATTERNS,
    });
  } else if (behavior === 'ask') {
    chrome.contextMenus.create({
      id: 'hoard-link',
      title: 'הורד מיד עם Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'hoard-link-queue',
      title: 'הוסף לתור Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: PATTERNS,
    });
  } else {
    // 'immediate' (default)
    chrome.contextMenus.create({
      id: 'hoard-link',
      title: 'הורד עם Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: PATTERNS,
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await rebuildContextMenus();
  updateBadge();
});

chrome.runtime.onStartup?.addListener(async () => {
  await rebuildContextMenus();
  updateBadge();
});

// Whenever the user changes settings (in options.html), rebuild the menu so
// they see the right item immediately on next right-click.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    const before = changes.settings.oldValue?.rightClickBehavior || 'immediate';
    const after = changes.settings.newValue?.rightClickBehavior || 'immediate';
    if (before !== after) rebuildContextMenus();
  }
  if (changes[QUEUE_KEY]) updateBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!info.linkUrl) return;
  const url = resolveMoodleUrl(info.linkUrl);
  const settings = await getSettings();
  const behavior = settings.rightClickBehavior || 'immediate';

  // Explicit "add to queue" menu always queues.
  if (info.menuItemId === 'hoard-link-queue') {
    await pushQueue({ url, linkText: info.selectionText || '', pageUrl: tab?.url });
    return;
  }
  if (info.menuItemId !== 'hoard-link') return;

  // The primary item's action depends on the setting:
  if (behavior === 'queue') {
    await pushQueue({ url, linkText: info.selectionText || '', pageUrl: tab?.url });
    return;
  }
  // 'immediate' and 'ask' (with the immediate menu item picked) both download.
  try {
    await chrome.downloads.download({ url, saveAs: !!settings.rightClickSaveAs });
  } catch (e) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Moodle Hoarder',
      message: 'שגיאת הורדה: ' + (e.message || e),
    });
  }
});

async function pushQueue(entry) {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] || [];
  queue.push({ ...entry, addedAt: Date.now() });
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  await updateBadge();
}

async function updateBadge() {
  try {
    const stored = await chrome.storage.local.get(QUEUE_KEY);
    const n = (stored[QUEUE_KEY] || []).length;
    await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' });
    if (n > 0) await chrome.action.setBadgeBackgroundColor({ color: '#dc2867' });
  } catch {}
}

// Allow popup/options to ask us to refresh the badge after they touch the queue.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'refreshBadge') {
    updateBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
});

function resolveMoodleUrl(url) {
  if (/\/mod\/resource\/view\.php/.test(url)) {
    return url + (url.includes('?') ? '&' : '?') + 'redirect=1';
  }
  const m = url.match(/\/mod\/folder\/view\.php\?(?:[^#]*&)?id=(\d+)/);
  if (m) {
    const u = new URL(url);
    return `${u.origin}/mod/folder/download_folder.php?id=${m[1]}`;
  }
  return url;
}
