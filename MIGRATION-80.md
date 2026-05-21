# ROADMAP #80 — Service Worker Downloads

מסמך תכנון מפורט להעברת לוגיקת ההורדה מהפופאפ ל-background service worker. **לא בוצע בסשן v1.16.0 בגלל הסיכון לשבירת זרימת ההורדה הליבה — נדרשת ריצה עם המשתמש ער כדי לבדוק כל שלב.**

## למה זה משנה

- היום: סגירת הפופאפ באמצע הורדה → ההורדה כושלת באמצע. ה-resume בכניסה הבאה דורש פעולה נוספת מהמשתמש.
- אחרי: ההורדה ממשיכה ברקע. הפופאפ יכול להיסגר חופשי. כשהוא נפתח שוב — מציג את ההתקדמות החיה.

ROI: גבוה. UX קופץ קומה.

## מצב נוכחי (גרסה v1.16.0)

`popup.js`:
- מבצע את כל ה-`fetch*` (fetchResource, fetchFolder, fetchAssign, fetchUrl, fetchPage, fetchBook, fetchQuiz, fetchLesson, fetchH5p, fetchScorm)
- מאגד בלובים ובונה ZIP בזיכרון (`zip.js`)
- קורא ל-`chrome.downloads.download()` עם blob URL
- מעדכן `chrome.storage.local` ל-checkpoint
- מציג progress bar + log lines תוך כדי

`background.js`:
- רק context menu + queue badge. **כלום** מההורדה.

## הארכיטקטורה החדשה

```
popup.js                     background.js (SW)
─────────                    ─────────────────
[user clicks הורד]
      │
      ├──msg: START_DOWNLOAD──►  [SW receives, starts job]
      │   { courseId, items,         │
      │     courseName, options }    ├── fetches in parallel pool
      │                              ├── builds ZIP
      ├──msg: GET_PROGRESS──►        ├── saves checkpoint
      │◄──{ done, total, log }─      ├── chrome.downloads.download()
      │                              ├── persists job state
      │ (popup closed)               │
      │                              │ (SW keeps running until done)
      │                              │
      [popup reopens]                │
      ├──msg: GET_PROGRESS──►        │
      │◄──{ done, total, log }─      │
      │                              │
      │◄──msg: DOWNLOAD_DONE──────   ├── job finished
      │   { downloadId, ckpt }       
```

## מה צריך לעשות (סדר עבודה)

### שלב 1 — חילוץ מודולים (no behavior change, easy to revert)

לעטוף את הקוד שכרגע ב-popup.js כך שניתן יהיה לטעון אותו גם ב-SW.

קבצים חדשים:
- `lib/fetchers.js` — כל ה-`fetch*` והעוזרים שלהם (`filenameFromResponse`, `sanitizeFilename`, `cleanText` וכו'). פונקציות טהורות, ללא תלות ב-DOM של הפופאפ.
- `lib/zip-builder.js` — wrapper סביב `zip.js` שמקבל רשימת `{path, blob}` וחוזר blob של ZIP.
- `lib/job-state.js` — read/write checkpoint, seen, history.

popup.js ו-background.js יטענו את אותו `lib/fetchers.js` דרך `importScripts` ב-SW ו-`<script src>` ב-popup.

**Watch out:**
- `fetchers.js` משתמש ב-`DOMParser`. ב-SW זה זמין (אומת ב-Chrome 124+).
- `URL.createObjectURL` זמין ב-SW.
- אסור להשתמש ב-`document.*` בכל הספרייה.

### שלב 2 — Job state ב-chrome.storage.local

key: `dljob_<courseId>` עם:
```json
{
  "courseId": "12345",
  "courseName": "...",
  "startedAt": 1700000000,
  "items": [...],          // הפריטים שנבחרו
  "results": { "5/123": {...} },   // מה כבר הצליח (checkpoint קיים)
  "errors": { "5/124": "msg" },
  "status": "running" | "done" | "error",
  "progress": { "done": 12, "total": 47, "currentName": "..." },
  "log": [{"ts":..., "msg":"...", "cls":"ok"}],
  "downloadId": 1234        // אחרי שה-ZIP הורד
}
```

### שלב 3 — Protocol הודעות

```js
// popup.js → SW
chrome.runtime.sendMessage({ type: 'startDownload', courseId, items, options })
chrome.runtime.sendMessage({ type: 'getJobState', courseId })
chrome.runtime.sendMessage({ type: 'cancelJob', courseId })

// SW → popup (broadcast)
chrome.runtime.sendMessage({ type: 'jobProgress', courseId, progress, log })
chrome.runtime.sendMessage({ type: 'jobDone', courseId, downloadId })
chrome.runtime.sendMessage({ type: 'jobError', courseId, error })
```

הפופאפ מאזין ב-`chrome.runtime.onMessage` ומעדכן את ה-UI.

### שלב 4 — שמירת ה-SW חי במהלך הורדה

ה-SW נסגר אחרי ~30 שניות של חוסר פעילות. למניעה:

**אפשרות א — Port persistence:**
ה-SW פותח `chrome.runtime.connect()` mock שלא נסגר. בעייתי כי SW לא יכול להחזיק client port לעצמו.

**אפשרות ב — chrome.alarms:**
המסמך הרשמי של Google ממליץ:
```js
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => { /* noop, just touches the SW */ });
```

**אפשרות ג — Active fetch:**
כל עוד יש `fetch` פתוח ב-SW, הוא לא ייסגר. אם המעבר בין items מהיר, אין בעיה. אבל אם הפיתוח כושל באמצע (לדוגמה משתמש מנותק רגעית) — fetch ייגמר, ו-SW עלול ליפול. חייב להוסיף keep-alive נוסף בכל זאת.

**גישה מומלצת:** אפשרות ב' (alarms) + טיפול נכון ב-fetch errors.

### שלב 5 — Storage limits

`chrome.storage.local` הוא 10MB. אסור לכתוב לשם blob גדול. ה-`results` של ה-checkpoint צריך לשמור **רק מטא** (path, name, sha) — לא blobs.

הקוד הנוכחי ב-popup.js כבר עושה זאת נכון (v1.8.1) — שומר marker למעלה מ-8MB. השמירה הזו צריכה להמשיך לעבוד ב-SW.

**אבל** — אם ה-SW נופל באמצע הורדה גדולה, ה-blob שכבר ירד אבוד. ה-resume יצטרך להוריד אותו שוב. זה כבר המצב היום, אז אין רגרסיה.

### שלב 6 — ביטול job

- כפתור "בטל" בפופאפ → `cancelJob` → ה-SW מסמן `status: 'cancelled'`.
- בלולאת ה-fetch ב-SW: בודק לפני כל item.
- אם המשתמש סוגר את הפופאפ וה-job עדיין רץ — הוא ממשיך. רק `cancelJob` עוצר.

### שלב 7 — תאימות אחורה

קורסים שכבר נמצאים באמצע הורדה (תחת ה-checkpoint הישן) — צריך path migration. או שפשוט נשאיר את ה-checkpoint הישן לשבוע ראשון, ואחר כך נמחק.

## בדיקות שחובה לעבור לפני שיפוצ'

1. הורדה רגילה של קורס קטן (5 פריטים) — עובדת.
2. הורדה רגילה של קורס גדול (50 פריטים) — עובדת.
3. סוגרים את הפופאפ באמצע הורדה — ההורדה ממשיכה, ה-ZIP נשמר בסוף.
4. פותחים את הפופאפ שוב באמצע הורדה — רואים פרוגרס חי.
5. ביטול באמצע — נעצר נקי, לא משאיר state פגום.
6. SW מת באמצע הורדה גדולה (אפשר לאלץ דרך chrome://serviceworker-internals) — Resume מהפופאפ פותר.
7. מתחילים שתי הורדות במקביל (משתמש פותח שני קורסים) — שניהם עובדים.
8. ZIP גדול (200MB+) — מסיים בלי OOM.
9. גם Multi-course download (`runMultiCourse`) עובר ל-SW.

## הערכת זמן (סשן עם המשתמש ער)

- שלב 1 (חילוץ): 1-2 שעות. שינוי מבני, אבל סטטי — אפשר להריץ ולוודא שהכל עובד כקודם.
- שלב 2-3 (state + protocol): 1 שעה. הגדרת ה-API.
- שלב 4-6 (SW logic): 2-3 שעות. הקוד הליבה.
- שלב 7 + בדיקות (1-9): 1-2 שעות.
- **סה"כ: 5-8 שעות**, פרושות לפחות ב-2-3 סשנים.

## חלופה קטנה יותר — אם נחוץ ROI מהיר

לחשוף את ה-resume בצורה אגרסיבית יותר:
- בתחילת ההורדה הצג בנר "אל תסגור את הפופאפ! אם תסגור — תוכל להמשיך מאיפה שהפסקת בכניסה הבאה."
- אם המשתמש סוגר ועוד-ועוד מתחיל חדש — בנר ידידותי יותר ("ההורדה הקודמת לא הסתיימה — להמשיך?").

זה לא פותר את הבעיה האמיתית אבל מפחית פרסטרציה. גודל: S (שעה).

## הערה אחרונה

אל תיגע בקוד Zoom בכל ההגירה (`resolveZoomPlayUrls`, `clickPlayAndCaptureUrl`). זה מבוסס על monkey-patch של `window.open` שדורש קונטקסט של עמוד אמיתי, לא SW. ה-Zoom downloads ישארו ב-popup לכל הפחות בגלגול הראשון.
