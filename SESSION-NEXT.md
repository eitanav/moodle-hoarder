# 🔄 הנדאוף לצ'אט חדש — Moodle Hoarder

> **קרא אותי קודם.** זה המסמך להמשך ישיר מאיפה שעצרנו. אחרי שתקרא — קרא גם `CHANGELOG.md` (5 גרסאות אחרונות) ו-`ROADMAP-100.md`.

## 🎯 פריצת דרך — המנגנון של Zoom פוענח (v1.31.0)

המחקר העמוק (`chrome.debugger` ב-background) תפס את בקשת ה-MP4 האמיתית. **המנגנון:**

1. `/nws/common/2.0/nak?pms=Recording...` → **JWT bearer token**.
2. `/nws/recording/1.0/play/info/<token>?originDomain=...` עם `Authorization: Bearer <JWT>` → JSON עם **`viewMp4Url`** (S3 presigned URL מלא).
3. `<video>` מושך מ-`ssrweb.zoom.us` עם `Range: bytes=0-` + **`Referer: https://<account>.zoom.us/`** → 206, video/mp4, ~115MB. MP4 ישיר, בלי HLS/DRM/MSE.

**הבאג שתוקן:** v1.28 שלח `Referer: https://zoom.us/`; ה-CDN דורש את **דומיין החשבון** (`ariel-ac-il.zoom.us`). Referer שגוי → 403 HTML → קובץ `.htm`. עכשיו `ensureZoomReferrerRule(origin)` גוזר את ה-origin מה-share URL.

**מצב:** טרם אומת ע"י המשתמש שההורדה עובדת אחרי התיקון. **שלב ראשון בסשן הבא:** לשאול אם 🎥 מוריד MP4 תקין ב-1.31.0.

**אם Referer לבד לא מספיק** — הדרך החסינה: לחקות את ה-API. ה-background כבר יודע לתפוס תגובות Network עם ה-debugger; לתפוס את תגובת `play/info`, לפרסר `viewMp4Url`, ולהוריד אותו ישירות (עוקף את תפיסת `<video>.src`). ראה `deepZoomResearch` ב-`background.js` כבסיס.

### לקח תפעולי קריטי (בזבז חצי סשן)
המשתמש טוען את התוסף מתיקייה מקומית. **כל השינויים שלי לא הגיעו אליו** כי (א) עבדתי על ברנץ׳ `claude/keen-volta-9pwtR` ו-main היה מאחור, (ב) ה-pull המקומי שלו נכשל/יצר clone מקונן. **פתרון:** מיזגתי הכל ל-main, והוספתי `update.bat` (דאבל-קליק → `git reset --hard origin/main`). תמיד לדחוף ל-main, ולהזכיר לו `update.bat` + Reload.

## איפה אנחנו (v1.31.0, git נקי, הכל בענן)

הפרויקט הוא תוסף Chrome (MV3) שאוסף חומר מקורסים במודל אריאל (`moodlearn.ariel.ac.il`) ל-ZIP. הרפו: https://github.com/eitanav/moodle-hoarder. תיקייה מקומית: `C:\Users\USER\Documents\Extensions\moodle-hoarder`.

### מה קרה בסשן האחרון (v1.18 → v1.25) — סאגת ה-Zoom + סילבוס

1. **תמלילי Zoom** (v1.18-v1.21) — עובד מצוין. debug capture חשף URL pattern → חילוץ אמיתי → parallel + early-skip + פורמטים + timestamps.
2. **VTT→TXT converter** (v1.21) — כפתור בפופאפ להמרת VTT ידנית.
3. **סילבוס meyda** (v1.22) — **מושהה.** meyda שבור server-side (Angular SPA שלא מרנדר תוכן, גם ידנית לא עובד). הקוד מוכן מאחורי `tryMeydaSyllabusDetour: false`.
4. **הורדת וידאו Zoom** (v1.23-v1.25) — **הפיצ'ר הגדול.** debug capture הוכיח: **MP4 ישיר** עם signed CloudFront URL על ה-`<video>` element (`ssrweb.zoom.us/.../Recording_1366x768.mp4?...Signature=...`). אין HLS, אין DRM, אין MSE.

### מצב הורדת הוידאו כרגע (v1.25.0)

- **שני כפתורים** בפיקר Zoom: 📄 קישורים+תמלילים, 🎥 הורד סרטונים
- **בורר איכות** (best/smallest/ask)
- `extractRecordingCandidates` — bg tab + monitor (MutationObserver + fetch/XHR patch) + click Play → אוסף signed URLs
- `pickRecordingUrl` — בוחר לפי איכות
- `downloadZoomRecordings` — worker pool, `chrome.downloads.download` עם ה-signed URL
- **chrome.downloads רץ ברמת browser → ההורדה ממשיכה גם אם סוגרים את הפופאפ** (עוקף את #80!)

## ⚠️ מה צריך בדיקה דחופה בתחילת הסשן הבא

**המשתמש דיווח שהורדת הוידאו לא עבדה ב-v1.24.** התיקון ב-v1.25 (כפתור ייעודי במקום הגדרה מוסתרת) אמור לפתור, אבל **טרם נבדק על ידי המשתמש.**

שאל את המשתמש: **"בדקת את כפתור 🎥 הורד סרטונים ב-v1.25? המ-MP4 ירד שלם?"**

אם עדיין לא עובד — האבחון:
1. בקש מהמשתמש לפתוח DevTools על הפופאפ (קליק ימני על אייקון → בדוק קופץ) → Console
2. לחיצה על 🎥 → לראות אם יש שגיאות אדומות
3. ה-status בפופאפ יראה את השגיאה הראשונה (למשל "לא נתפס קישור וידאו")
4. אם "לא נתפס קישור וידאו" → ה-Play לא נלחץ או ה-`<video>` לא קיבל src תוך 25 שניות. אולי צריך עוד selectors או timeout ארוך יותר. אפשר להוסיף debug capture שמראה מה נתפס.

**טיפ:** ה-signed URL פג תוך ~שעתיים. אם המשתמש סרק לפני הרבה זמן ואז לחץ 🎥 — ייכשל. צריך לסרוק מחדש סמוך ללחיצה.

## בקשות פתוחות מהמשתמש (לא הושלמו)

1. ~~**בורר איכות אמיתי ('ask')**~~ — ✅ **בוצע ב-v1.26.0.** 'ask' עכשיו מחלץ את כל הרזולוציות מראש (`resolveRecordingCandidates`), מציג מודאל בחירה בפופאפ (`chooseQualityDialog`), ומוריד מהקישורים שכבר נאספו (בלי חילוץ חוזר). **טרם נבדק על קורס אמיתי** — צריך לאמת שהמודאל קופץ ושההורדה יורדת ברזולוציה הנכונה.
2. **גרסה 2.0** — המשתמש שאל מתי מוצדק. ראה סעיף למטה.

## על גרסה 2.0 — מה אמרתי למשתמש

2.0 מוצדק כשיש **headline feature שמגדיר מחדש את הכלי**. הורדת וידאו אמיתית **היא** כזו. ההמלצה שלי:
- כש **(א)** הורדת הוידאו עובדת יציב ונבדקה על קורס שלם, **(ב)** בורר האיכות האמיתי מוכן, **(ג)** ה-UX של ה-Zoom מלוטש —
- **אז מקפיצים ל-2.0.** זה ככל הנראה עוד 1-2 סשנים.
- 2.0 ראוי לגם README מעודכן + אולי screenshots + סיכום "מה חדש מאז 1.0".

## משימות פתוחות אחרות (ROADMAP)

- **#80 service worker downloads** — ראה MIGRATION-80.md. **כבר פחות דחוף** כי הוידאו עוקף אותו דרך chrome.downloads. עדיין רלוונטי להורדות קורס גדולות.
- **#21 PDF renaming by title** — L, צריך pdf.js.
- **סילבוס meyda** — מחכה ש-meyda יחזור לעבוד server-side.
- **תמלילים בהורדת קורס** — כרגע רק בזרימת Zoom-LTI.

## כללי זהב (חובה)

1. **אל תיגע ב-Zoom resolver** (`resolveZoomPlayUrls`, `waitForDetailPage`, `clickPlayAndCaptureUrl`, `expandTimelineActivities`) — שביר, monkey-patch על window.open.
2. **כן מותר** לגעת בקוד החדש שלי: `extractRecordingCandidates`, `extractZoomTranscripts`, `fetchMeydaSyllabus`, `downloadZoomRecordings`, `captureZoomNetworkDebug`.
3. **כל פיצ'ר עם on/off → ב-options.html** (אבל פעולות חד-פעמיות כמו "הורד סרטונים" → כפתור בפופאפ).
4. **CHANGELOG.md לכל גרסה** — "הבעיה לפני / הפתרון / איך לבחון", בעברית.
5. **bidi marks בעברית:** `replace(/[‎‏‪-‮⁦-⁩﻿]/g, '')` לפני regex match.
6. **Windows filenames:** תמיד `sanitizeFilename()`.
7. **debug-driven:** כשמשהו לא ידוע (URL pattern, DOM structure) — בנה debug capture, בקש מהמשתמש להריץ, אל תנחש. זה עבד פעמיים (תמלילים + וידאו).
8. **כשהשרת שבור — לא הקוד.** (לקח מ-meyda.)

## מבנה קבצים (תזכורת מהירה)

| קובץ | תפקיד |
|------|--------|
| `popup.js` (~2900 שורות) | כל הלוגיקה: scan, download, ZIP, ICS, Zoom transcripts+video, meyda |
| `popup.html` | 5 views: initial/picker/multi/zoom/deadlines + VTT converter |
| `options.html` + `options.js` | הגדרות |
| `settings.js` | SETTINGS_DEFAULTS + getSettings |
| `i18n.js` | he/en dictionary + applyLanguage |
| `background.js` | context menu + queue badge |
| `content_dashboard.js` | הסתרת מטלות ב-/my/ |
| `zip.js` | ZIP writer (store-only, Unicode) |

## פונקציות מפתח להורדת וידאו (לעיון מהיר)

- `extractRecordingCandidates(rec)` — popup.js ~1594. פותח tab, monitor, Play, מחזיר signed URLs.
- `pickRecordingUrl(candidates, quality)` — בוחר best/smallest.
- `pickRecordingUrlByLabel(candidates, label)` — בוחר לפי הרזולוציה שנבחרה ב-'ask' (fallback לקרובה ביותר).
- `resolveRecordingCandidates(recordings, onProgress, concurrency)` — שלב איתור: מחזיר `[{recording, candidates}]`.
- `summariseResolutions(resolved)` — בונה רשימת רזולוציות ייחודיות לדיאלוג.
- `downloadResolvedRecordings(resolved, subfolder, picker, onProgress)` — שלב הורדה מהקישורים שכבר נאספו.
- `chooseQualityDialog(options)` — מודאל הבחירה בפופאפ (מחזיר Promise<value|null>).
- `downloadZoomRecordings(...)` — wrapper דק (resolve+download) ל-best/smallest.
- `$('downloadZoomVideos')` handler — popup.js ~1333 (כולל ענף 'ask').
- `vttToCleanText(vtt)` — popup.js ~1573. (timestamped TXT)
- `_resolutionScore` / `_resolutionLabel` — popup.js ~1567. (פרסור 1366x768 משם הקובץ)

## להתחיל מהר

1. `git pull`
2. קרא CHANGELOG.md (v1.25 → v1.18)
3. **שאל את המשתמש אם כפתור 🎥 עבד** — זה ה-blocker הראשי.
4. אם עבד → בורר איכות אמיתי, ואז דיון 2.0.
5. אם לא → debug על extractRecordingCandidates.
