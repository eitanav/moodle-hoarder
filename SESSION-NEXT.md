# הנדאוף — לסשן הבא

## מצב אחרון (v1.20.1)

- ✅ תמלילי Zoom עובדים מצוין — chain מלא: extract URL → open bg tab → catch VTT XHR → vttToCleanText → ZIP
- ✅ Parallel (3 במקביל), early-skip (8s), טוגלי פורמט, שמות חכמים
- ✅ ברירת מחדל הוחלפה ל-`transcriptFormats: 'txt'` (משתמש ביקש)

## משימה #1 — סילבוס (קריטי)

### הבעיה כפי שדווחה ע"י המשתמש

"אני לא מצליח להבין איך להוריד את זה בצורה פשוטה, וסילבוס זה חומר קריטי."

זה אומר: גם עם 4-layer fallback ש-v1.9.0 הוסיף, הסילבוס לא ירד באופן ידידותי, או נופל לחלוטין.

### מה צריך לחקור בסשן הבא

הקוד הקיים של סילבוס נמצא ב-`fetchUrl` / `fetchResource` ב-popup.js, עם השכבות:
1. ניסיון `mod/url/view.php?redirect=1` → אם קובץ ישיר, מוריד
2. אם HTML — לחפש `urlworkaround` / `<meta refresh>` / `window.location`
3. fetch של ה-URL החיצוני
4. אם זה HTML — חיפוש קישור download בתוכו ומעקב שלב נוסף

צריך **לראות את ה-DOM האמיתי של עמוד סילבוס באריאל** כדי לדעת איפה זה נופל. אופציות לפתרון:

#### גישה א — Debug capture כמו עם ה-Zoom
מצב debug אופציונלי שכש-fetchUrl נכשל על סילבוס, יציל את ה-HTML של כל שלב לקובץ `syllabus-debug-<id>.html`, ו-aggregates ל-JSON של chain. דומה ל-v1.18.0 ל-Zoom.

#### גישה ב — לבקש מהמשתמש לפתוח סילבוס ידנית בטאב חדש ולשלוח HTML
פחות עבודה לי, יותר עבודה לו. אבל הכי ישיר.

#### גישה ג — להוסיף "Open & download manually" כפתור צמוד לסילבוס בפיקר
אם לא מצליחים לחלץ אוטומטית, פותחים את ה-link בטאב חדש; המשתמש כבר יראה את ה-PDF ויוריד מ-Chrome. פתרון UX, לא טכני.

### מה אני צריך מהמשתמש בתחילת הסשן הבא

**מאוד חשוב:** לקבל ממנו אחד מהשניים:

1. **קישור לקורס מודל אריאל שבו הסילבוס בעייתי** + שיריץ "סרוק" ויראה אם הסילבוס מופיע ברשימת הפריטים, ואם כן — אילו שגיאות יש ב-log אחרי הניסיון להוריד
2. **דמפ של ה-HTML של עמוד הסילבוס** (View Source או DevTools → Sources → Page) — אז אני יכול לזהות את הדפוס בלי גישה אישית

### תוכנית עבודה משוערת

1. הבנה מהמשתמש איפה הסילבוס נופל (5 דקות)
2. עיון בקוד fetchUrl + הוספת לוגים זמניים (10 דקות)
3. תיקון לפי הממצא — סביר שעוד שכבת fallback או handling של redirect חדש (30 דקות)
4. v1.21.0 עם תיקון סילבוס + בדיקה אמיתית מול הקורס של המשתמש

## משימה #2 — עוד פיצ'רים פתוחים (לא בוערים)

- **#80 service worker downloads** — תוכנן ב-MIGRATION-80.md, L בגודל
- **#21 PDF renaming by title** — L, צריך pdf.js
- **#28 quiz attempts archive**
- **#82 pause/resume**

## משימה #3 — שיפורי תמלילים אפשריים (לעתיד)

- **timestamp-aware TXT** — אופציה שלישית לפורמט שמשמרת timestamps בפורמט קריא: `[10:23] Speaker: text`. שימושי לציטוט.
- **תמלילים לתוך הורדת קורס** — היום זה רק בזרימת Zoom-LTI. כדאי שאם המשתמש מוריד קורס מלא + יש לו לינקים ל-Zoom בקורס, התמלילים יורדו אתם.
- **VTT converter standalone** — קלט: VTT שהמשתמש משיג ממקור אחר. פלט: TXT. כפתור "המר VTT" בפופאפ.

## ל-Claude הבא

- אל תיגע בקוד Zoom ה-resolver (`resolveZoomPlayUrls`, `waitForDetailPage`, `clickPlayAndCaptureUrl`) — שביר ועדין
- **כן** אפשר לגעת ב-`extractZoomTranscripts` / `extractOneTranscript` — זה קוד חדש שכתבתי, פחות רגיש
- כל פיצ'ר חדש עם on/off → ב-options.html, לא בפופאפ (כלל זהב)
- CHANGELOG.md לכל גרסה, עם "הבעיה לפני / הפתרון / איך לבחון"
- שמירת bidirectional marks בעברית: `replace(/[‎‏‪-‮⁦-⁩﻿]/g, '')` לפני regex match
- Windows filename sanitisation: `sanitizeFilename()` תמיד
