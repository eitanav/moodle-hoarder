# Chrome Web Store — submission notes

This branch (`store`) is the **store build**: the `key`, `debugger`, and
`nativeMessaging` were removed, and the GitHub update-checker + native-host
updater were stripped (the Web Store auto-updates). Develop on `main`; rebuild
`store` from it when shipping a new store version.

---

## Listing fields

**Name:** Moodle Hoarder

**Short description (≤132 chars):**
> Download every file, folder, assignment and recording link from your Moodle course into one tidy ZIP — plus a deadlines calendar.

**Category:** Productivity
**Language:** Hebrew (primary), English

**Full description (paste, edit freely):**
```
Moodle Hoarder grabs an entire Moodle course in one click — files, folders,
assignments, your submissions, pages, the syllabus, external links and lecture
recording links — and packs them into one tidy ZIP with neat subfolders. It
also builds a deadlines.ics you can import into Google/Outlook/Apple Calendar.

Features
• Scan by section with a picker — choose exactly what to download
• Files, folders, assignments and submissions, each in its own subfolder
• Deadlines → ICS calendar file
• Detects recordings (Zoom, Panopto, Kaltura, YouTube, Webex, Teams) and saves
  them as links in a separate file
• Zoom cloud recordings: extract share links + auto-transcripts (VTT/TXT)
• Diff mode — on later scans, only grab what's new
• Multi-course download from the "My courses" page
• Right-click "Download with Moodle Hoarder" on any link
• Automatic dark mode, full RTL, Hebrew + English UI

Privacy-first: everything runs locally in your browser. No analytics, no
tracking, your course content never leaves your machine.

Unofficial tool, not affiliated with any university. For personal use only —
download your own course materials; don't redistribute copyrighted content.
Provided as-is, without warranty.
```

**Privacy policy URL:** https://github.com/eitanav/moodle-hoarder/blob/main/PRIVACY.md

**Single purpose:**
> Download a user's own Moodle course materials into a ZIP for offline/backup use.

**Data usage disclosures:** The extension does NOT collect or transmit personal
data. The only network calls are to the Moodle/Zoom sites you're using, and —
only if you explicitly submit the feedback form — your typed message to
Web3Forms. Tick "No" for all data-collection categories except, optionally,
"User-provided content" → only when the user sends feedback.

---

## Permission justifications (paste into the dashboard)

- **activeTab + scripting** — read the open Moodle course page to find and
  collect the items the user chose to download.
- **downloads** — save the resulting ZIP and files.
- **storage / unlimitedStorage** — store settings, download history and
  resume-checkpoints for large downloads, locally on the device.
- **notifications** — notify the user when a download finishes.
- **contextMenus** — the right-click "Download with Moodle Hoarder" menu item.
- **offscreen** — fetch and assemble Zoom cloud-recording video blobs in the
  extension origin (needed to save large MP4s correctly).
- **declarativeNetRequest** — add a Referer header so Zoom cloud-recording
  files can be fetched for download.
- **host: moodlearn.ariel.ac.il, *.ariel.ac.il** — the Moodle site the
  extension operates on.
- **host: zoom.us, *.zoom.us** — read Zoom recording pages to extract links.
- **host: api.web3forms.com** — deliver the optional in-extension feedback
  form (only when the user clicks "Send").

---

## Screenshots to capture (1280×800, you take these)

1. The popup on a course page after **Scan** — the section picker with items.
2. The **options page top** — the "time saved" card + a couple of settings.
3. A finished download / the ZIP structure in a file explorer (optional).
4. The Zoom recordings picker (optional).
Aim for 2–4 clean shots. Crop to 1280×800. You can add a simple caption.

---

## Build the upload ZIP (from this `store` branch)

Include only the extension files — not docs, transcriber, or git:

```bash
# from the repo root on the `store` branch
zip -r moodle-hoarder-store.zip \
  manifest.json background.js popup.html popup.js options.html options.js \
  settings.js i18n.js updates.js zip.js content_dashboard.js \
  offscreen.html offscreen.js theme-bootstrap.js icons
```

Upload `moodle-hoarder-store.zip` in the Developer Dashboard → new item.

---

## Known note

Some isolated, **unreachable** `chrome.debugger` code remains in `popup.js` /
`background.js` (the old diagnostic). It can't run — the `debugger` permission
is no longer declared and the UI that triggered it was removed. If a reviewer
asks about it, strip those functions (they're self-contained) and resubmit.
