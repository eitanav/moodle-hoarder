// Context-menu: right-click any link on Moodle → download via Hoarder.
// Resolves Moodle resource view URLs to the actual file (redirect=1).

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'hoard-link',
      title: 'הורד עם Moodle Hoarder',
      contexts: ['link'],
      documentUrlPatterns: ['*://moodlearn.ariel.ac.il/*', '*://*.ariel.ac.il/*'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== 'hoard-link' || !info.linkUrl) return;
  try {
    const url = resolveMoodleUrl(info.linkUrl);
    await chrome.downloads.download({ url, saveAs: false });
  } catch (e) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Moodle Hoarder',
      message: 'שגיאת הורדה: ' + (e.message || e),
    });
  }
});

function resolveMoodleUrl(url) {
  // mod/resource/view.php → add redirect=1 so Moodle 303s directly to the file
  if (/\/mod\/resource\/view\.php/.test(url)) {
    return url + (url.includes('?') ? '&' : '?') + 'redirect=1';
  }
  // mod/folder/view.php → swap to download_folder.php for a server-side zip
  const m = url.match(/\/mod\/folder\/view\.php\?(?:[^#]*&)?id=(\d+)/);
  if (m) {
    const u = new URL(url);
    return `${u.origin}/mod/folder/download_folder.php?id=${m[1]}`;
  }
  return url;
}
