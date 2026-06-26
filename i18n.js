// ===================== i18n =====================
// Shared translation module — loaded by popup.html and options.html. Holds
// the Hebrew/English string dictionary plus helpers for resolving the
// effective UI language and applying translations to the DOM.
//
// Language resolution (in order):
//   1. settings.uiLanguage = 'he' or 'en' → forced.
//   2. settings.uiLanguage = 'auto' → look at the user's active Moodle tab
//      <html lang> if available; fall back to navigator.language; default 'he'.
//
// Strings are keyed by stable identifiers. HTML files use [data-i18n="key"]
// (text content) and [data-i18n-attr="attr:key,attr:key"] (specific attrs).
// JS code calls t(key) directly.
//
// Coverage is intentionally partial: the buttons / section headers /
// language picker itself are translated, but most help text remains
// Hebrew (which is the primary user base — Ariel University students).
// Untranslated strings fall back to the Hebrew text in the HTML, which
// is the safe default.

const MH_STRINGS = {
  he: {
    // Header
    'app.title': 'Moodle Hoarder',
    'app.tagline': 'אוסף לך הכל מהמודל לתיק אחד',
    'app.settings.title': 'הגדרות',
    'options.header.title': 'Moodle Hoarder — הגדרות',
    'options.header.sub': 'כל הטוגלים והאופציות במקום אחד',

    // Common buttons
    'btn.scan': 'סרוק',
    'btn.back': 'חזור',
    'btn.download.zip': 'הורד ל-ZIP',
    'btn.download.all': 'הורד את כל הקורסים שנבחרו',
    'btn.select.all': 'הכל',
    'btn.select.none': 'ניקוי',
    'btn.select.defaults': 'איפוס',
    'btn.export.deadlines': 'ייצא ליומן',
    'btn.decode.zoom': 'פענח קישורים והורד',
    'btn.only.new': 'בחר רק חדשים',

    // Initial hint
    'initial.hint': 'פתח דף קורס במודל (course/view.php) או דף הקורסים שלי (my/courses.php) ולחץ "סרוק".',

    // Picker labels
    'picker.search.placeholder': 'חיפוש...',
    'picker.selected.of': 'מתוך',
    'picker.selected.suffix': 'נבחרו',
    'picker.expand.all.title': 'פתח/סגור הכל',

    // Multi-course view
    'multi.found.prefix': 'נמצאו',
    'multi.found.suffix': 'קורסים בעמוד "הקורסים שלי".',
    'multi.search.placeholder': 'חיפוש קורס...',
    'multi.only.new': 'הורד רק קבצים חדשים בכל קורס',

    // Deadlines view
    'deadlines.found.prefix': 'נמצאו',
    'deadlines.found.suffix': 'מטלות (ללא המוסתרות).',
    'deadlines.help.ical': 'סמן אילו מטלות לכלול בקובץ היומן. אחרי ההורדה — לחיצה כפולה תוסיף אותן ל-Google Calendar / Outlook / Apple Calendar.',
    'deadlines.help.mycourses': '💡 כדי להוריד קבצי קורסים — עבור לדף "הקורסים שלי" ולחץ שוב על אייקון התוסף.',

    // Zoom view
    'zoom.found.prefix': 'נמצאו',
    'zoom.found.suffix': 'הקלטות. בחר אילו לפענח קישורים אליהן:',
    'zoom.search.placeholder': 'חיפוש בהקלטות...',
    'zoom.selected.suffix': 'נבחרו',

    // Options page section titles
    'opt.section.appearance': 'מראה',
    'opt.section.zip': 'מבנה ה-ZIP',
    'opt.section.download': 'הורדה',
    'opt.section.content': 'תוכן',
    'opt.section.rightclick': 'קליק ימני',
    'opt.section.history': 'היסטוריה',
    'opt.section.reset': 'איפוס',
    'opt.section.language': 'שפת ממשק',

    // Language picker
    'opt.lang.title': 'שפת ממשק',
    'opt.lang.hint': '"אוטומטי" יקבע את השפה לפי הקורס הפתוח כעת ב-Moodle (לפי תג ה-<code>&lt;html lang&gt;</code>). אחרת — בחירה ידנית.',
    'opt.lang.auto': 'אוטומטי',
    'opt.lang.he': 'עברית',
    'opt.lang.en': 'English',

    // Common status messages
    'status.saved': 'נשמר',
    'status.scanning': 'סורק...',
    'status.downloading': 'מוריד...',
    'status.zipping': 'יוצר ZIP...',
    'status.done': 'הושלם',
    'status.error': 'שגיאה',

    // Dynamic status (popup.js setStatus + logLine)
    'status.opening.activities': 'פותח את כל הפעילויות...',
    'status.scanning.deadlines': 'סורק דדליינים...',
    'status.no.deadlines': 'לא נמצאו מטלות. ודא שטעון "ממתין לביצוע" ונסה שוב.',
    'status.error.with.message': 'שגיאה: {msg}',
    'status.downloading.queue': 'מוריד {n} פריטים בתור...',
    'status.queue.failed': 'כשל בהורדת התור.',
    'status.zipping.bundle': 'מארז ZIP...',
    'status.completed.with.count': 'הושלם: {n} פריטים, {size}.',
    'status.checking.page': 'בודק עמוד...',
    'status.waiting.zoom': 'ממתין שדף ה-Zoom ייטען...',
    'status.no.zoom': 'לא נמצאו הקלטות. ראה את הקובץ שירד לפרטים.',
    'status.scanning.courses': 'סורק קורסים...',
    'status.no.courses': 'לא נמצאו קורסים. גלול מטה כדי שכל הקורסים יטענו ונסה שוב.',
    'status.scanning.course': 'סורק קורס...',
    'status.no.items': 'לא נמצאו פריטים בדף.',
    'status.wrong.page': 'יש לעבור לדף קורס במודל אריאל או לדף "הקורסים שלי".',
    'status.zoom.start': 'מתחיל פענוח קישורים ל-{n} הקלטות — אל תסגור!',
    'status.zoom.no.urls': 'לא נמצאו URLs. הורד גם zoom-detail-debug HTML.',
    'status.zoom.results': 'הושלם: {ok}/{total} קישורים נמצאו.',
    'status.completed': 'הושלם.',
    'status.downloading.parallel': 'מוריד {n} פריטים במקביל (עד {c} בו-זמנית)...',
    'status.no.deadlines.selected': 'בחר לפחות מטלה אחת עם תאריך הגשה.',
    'status.exported.deadlines': 'יוצאו {n} מטלות ל-ICS.',
    'log.nothing.to.download': '— {name}: אין מה להוריד',
    'log.course.items': '✓ {name}: {n} פריטים',
    'log.grades.failed': '✗ שליפת ציונים: {msg}',
    'err.no.active.tab': 'אין טאב פעיל',
    'err.file.not.found': 'לא נמצא קובץ',
    'err.folder.empty': 'תיקייה ריקה / חסומה',

    // Confirm dialogs, notifications, diff banners
    'queue.clear.confirm': 'לרוקן את התור?',
    'notif.queue.done': '{n} פריטים מהתור הורדו',
    'notif.multi.done': 'הסתיימה הורדת {n} קורסים',
    'notif.course.done': 'הורדו {n} פריטים מ-"{name}"',
    'size.over.tooltip': 'מעל {mb}MB — סומן אדום ובוטלה בחירה. אפשר לסמן ידנית בכל זאת.',
    'size.checking': 'בודק גדלי קבצים…',
    'size.checking.progress': 'בודק גדלי קבצים… {done}/{total}',
    'size.summary.over': '{n} קבצים מעל {mb}MB סומנו באדום וביטלתי את הבחירה — אפשר לסמן ידנית.',
    'diff.checkpoint': 'נמצאה הורדה לא-גמורה מ-{date} ({n} פריטים כבר ירדו). הם יישמרו וההורדה תמשיך משם.',
    'diff.previous': 'נמצאה הורדה קודמת מתאריך {date} — {n} פריטים חדשים מאז.',
    'diff.chip.new': 'חדש',
    'diff.chip.notdefault': 'לא בדיפולט',
    'multi.pin.title': 'בטל הצמדה',
    'multi.unpin.title': 'הצמד למעלה',

    // content_dashboard.js — buttons injected into the Moodle dashboard
    'dash.hide': 'הסתר',
    'dash.hide.title': 'הסתר מטלה זו (Moodle Hoarder)',
    'dash.unhide': 'החזר',
    'dash.unhide.title': 'החזר מטלה זו לרשימה',
    'dash.clear.all': 'בטל הכל',
    'dash.clear.all.title': 'החזר את כל המטלות המוסתרות לרשימה',
    'dash.clear.all.confirm': 'להחזיר את כל {n} המטלות המוסתרות לרשימה?',
    'dash.count.hidden': '{n} מטלות מוסתרות',
    'dash.show.hidden': 'הצג מוסתרות',
    'dash.hide.again': 'הסתר שוב',

    // ----- Options page: full section copy -----
    'opt.lang.desc': 'בחר את שפת הממשק של התוסף (לא משפיע על תוכן הקורסים)',

    'opt.appearance.desc': 'בהיר / כהה / לפי הגדרת מערכת ההפעלה',
    'opt.theme.name': 'ערכת נושא',
    'opt.theme.hint': '"אוטומטי" יתאם את עצמו להגדרת מצב כהה של Windows/macOS. "בהיר" / "כהה" כופים בצורה ידנית.',
    'opt.theme.auto': 'אוטומטי',
    'opt.theme.light': 'בהיר',
    'opt.theme.dark': 'כהה',
    'opt.accent.name': 'צבע ראשי',
    'opt.accent.hint': '"כתום-ורוד" הוא הצבע הברירת-מחדל של התוסף. "כחול אריאל" מתאים לערכת הצבעים של אוניברסיטת אריאל.',
    'opt.accent.orangepink': 'כתום-ורוד',
    'opt.accent.blue': 'כחול אריאל',
    'opt.compact.name': 'מצב קומפקטי',
    'opt.compact.hint': 'פריטים בשורה אחת קטנה במקום שתיים. נוח לקורסים גדולים עם הרבה פריטים.',

    'opt.zip.desc': 'איך לארגן את הקבצים בתוך קובץ ה-ZIP שמורד',
    'opt.zip.layout.name': 'פריסה',
    'opt.zip.layout.hint': '"לפי קטעים" יוצר תיקייה לכל קטע במודל. "הכל ביחד" שם את כל הקבצים בתיקייה אחת שטוחה. "שניהם" מייצר את שני המבנים בתוך אותו ZIP (ברירת מחדל, ZIP גדול פי שניים).',
    'opt.zip.sections': 'לפי קטעים',
    'opt.zip.flat': 'הכל ביחד',
    'opt.zip.both': 'שניהם',

    'opt.download.desc': 'איפה וכיצד נשמרים הקבצים',
    'opt.saveas.name': '"Save As" — לבחור איפה לשמור',
    'opt.saveas.hint': 'בכל הורדה ייפתח דיאלוג של Chrome לבחירת מיקום. ברירת מחדל כבוי — הקובץ יורד אוטומטית לתיקיית Downloads.',
    'opt.subfolder.name': 'תת-תיקייה ב-Downloads',
    'opt.subfolder.hint': 'למשל <code>Moodle/2026-spring/</code> — Chrome לא מאפשר נתיב מוחלט מתוסף, אבל אפשר ליצור תת-תיקייה בתוך Downloads. השאר ריק כדי לשמור ישירות ב-Downloads.',

    'opt.content.desc': 'אילו פעילויות לכלול בהורדה',
    'opt.grades.name': 'כלילת ציונים',
    'opt.grades.hint': 'שולף את העמוד Grader Report של הקורס ומוסיף ל-ZIP כקובץ <code>ציונים.csv</code>. <strong>שים לב — כשמשתפים את ה-ZIP, גם הציונים שלך נכללים.</strong> ברירת מחדל כבוי.',
    'opt.json.name': 'כלילת <code>course.json</code>',
    'opt.json.hint': 'מוסיף ל-ZIP קובץ JSON מובנה עם מבנה הקורס המלא — sections, items, types, URLs, גדלי קבצים, errors. שימושי לאינטגרציות עם Notion / Anki / Sheets / סקריפטים. קטן (~10-50KB), לא כולל את הקבצים עצמם. ברירת מחדל פעיל.',
    'opt.maxsize.name': 'סף גודל קובץ (MB)',
    'opt.maxsize.hint': 'קבצים גדולים מהסף לא יסומנו בדיפולט בבורר הקורס — תקבל אזהרה ותוכל לסמן ידנית. <code>0</code> = מבוטל (כל הקבצים נבחרים כרגיל).',
    'opt.filetypes.name': 'סוגי פעילויות מסומנים כברירת מחדל',
    'opt.filetypes.hint': 'בעת סריקה של קורס, הפעילויות האלה מסומנות אוטומטית. עדיין ניתן לבחור ידנית פר קורס.',

    'opt.zoom.desc': 'הגדרות הקלטות Zoom (חלות רק כשפותחים דף Zoom Recordings באריאל)',
    'opt.zoom.video.name': 'הורדת קובצי הוידאו (MP4)',
    'opt.zoom.video.hint': 'הורדת ההקלטות עצמן מתבצעת דרך כפתור 🎥 <strong>"הורד סרטונים"</strong> שמופיע אחרי סריקת דף ה-Zoom — לא צריך טוגל כאן. כל הקלטה נשמרת בנפרד ב-Downloads (או בתת-התיקייה שהגדרת). קבצים גדולים — 200MB עד 2GB כל אחד. ההורדה ממשיכה ברקע גם אם תסגור את הפופאפ.',
    'opt.zoom.video.control': 'דרך כפתור 🎥',
    'opt.zoom.transcripts.name': 'חילוץ תמלילים אוטומטי',
    'opt.zoom.transcripts.hint': 'אחרי שמחלצים URLs של הקלטות, התוסף פותח כל אחת ב-tab רקעי ותופס את ה-VTT (התמליל האוטומטי של Zoom). אם כיבית — תקבל רק קובץ טקסט עם הקישורים, בלי ZIP. <strong>הקלטות בלי תמליל מדולגות אחרי 8 שניות</strong> (בודק שיש UI של תמליל בדף).',
    'opt.zoom.format.name': 'פורמט תמלילים',
    'opt.zoom.format.hint': '"שניהם" — גם <code>.vtt</code> מקורי (עם timestamps, יושב כסאבטייטל על וידאו) וגם <code>.txt</code> נקי לקריאה (עם דוברים ופסקאות). "רק טקסט" / "רק VTT" מקטינים את ה-ZIP.',
    'opt.zoom.format.both': 'שניהם',
    'opt.zoom.format.txt': 'רק טקסט',
    'opt.zoom.format.vtt': 'רק VTT',
    'opt.zoom.concurrency.name': 'מספר הקלטות במקביל',
    'opt.zoom.concurrency.hint': 'כמה תמלילים לחלץ בו-זמנית. 3 זה איזון טוב בין מהירות לעומס. גבוה יותר (4-5) ייתכן שיגרום ל-Zoom לחסום או יכבד על המחשב. תחום: 1-5.',

    'opt.rightclick.desc': 'התנהגות התפריט "הורד עם Moodle Hoarder"',
    'opt.rightclick.action.name': 'פעולה',
    'opt.rightclick.action.hint': '"מיד" — הורד מיד את הקובץ. "תור" — הוסף לרשימה ובסיום הורד את כולם כ-ZIP אחד. "שאל" — תפריט קצר בכל קליק.',
    'opt.rightclick.immediate': 'מיד',
    'opt.rightclick.queue': 'תור',
    'opt.rightclick.ask': 'שאל',
    'opt.rightclick.saveas.name': '"Save As" בקליק ימני',
    'opt.rightclick.saveas.hint': 'פתח דיאלוג לבחירת מיקום בכל הורדה דרך קליק ימני (גם כשהטוגל הגלובלי כבוי).',

    'opt.history.desc': 'כל ההורדות האחרונות — קורסים, קישורים/תמלילים וסרטוני Zoom. לחיצה פותחת שוב את מקור ההורדה כשיש קישור.',
    'opt.history.clear': 'נקה היסטוריה',
    'opt.history.col.download': 'הורדה',
    'opt.history.col.type': 'סוג',
    'opt.history.col.items': 'פריטים',
    'opt.history.col.status': 'סטטוס',
    'opt.history.col.size': 'גודל',
    'opt.history.col.date': 'תאריך',
    'opt.history.col.action': 'פעולה',
    'opt.history.empty': 'עוד לא הורדת אף קורס או הקלטה',
    'opt.history.open': 'פתח',
    'opt.history.counts': '{ok}/{total} ({failed} נכשלו)',
    'opt.history.fallback': 'הורדה',
    'opt.history.legacy.course': 'קורס {id}',
    'opt.history.type.course': 'קורס ZIP',
    'opt.history.type.zoomlinks': 'Zoom קישורים/תמלילים',
    'opt.history.type.zoomvideos': 'Zoom סרטונים',
    'opt.history.type.legacy': 'קורס (Diff ישן)',
    'opt.history.status.success': 'הצליח',
    'opt.history.status.partial': 'חלקי',
    'opt.history.status.failed': 'נכשל',
    'opt.history.clear.confirm': 'למחוק את כל היסטוריית הקורסים שהורדת? (לא ימחק קבצים שכבר ירדו)',

    'opt.reset.desc': 'איפוס כל ההגדרות לברירת המחדל',
    'opt.reset.name': 'איפוס',
    'opt.reset.hint': 'מאפס את כל ההגדרות לערכי ברירת המחדל. לא משפיע על היסטוריה או מצב diff.',
    'opt.reset.btn': 'אפס הגדרות',
    'opt.reset.confirm': 'לאפס את כל ההגדרות לברירת המחדל?',

    'opt.about.title': 'אודות',
    'opt.about.story': 'Moodle Hoarder נולד מתוך תסכול — חבורת סטודנטים שנמאס להם להוריד כל קובץ בנפרד ולהיאבק במודל איטי ומסורבל, החליטו פשוט להפוך אותו לכלי אחד יעיל שמוריד את כל הקורס בלחיצה אחת.',
    'opt.about.copy': '© {year} E.A — כל הזכויות שמורות.',
    'opt.about.feedback': 'דיווח על באג או הצעה לשיפור',
    'opt.about.donate': '☕ קנה לי קפה / תודה',

    // Feedback form
    'opt.section.feedback': '💬 פידבק והצעות',
    'opt.feedback.desc': 'מצאת באג? יש לך רעיון לפיצ׳ר? כתוב לי כאן וזה יגיע אליי ישירות.',
    'opt.feedback.type.label': 'סוג',
    'opt.feedback.type.bug': '🐞 באג',
    'opt.feedback.type.feature': '💡 הצעת פיצ׳ר',
    'opt.feedback.type.other': '💬 אחר',
    'opt.feedback.message.ph': 'כתוב כאן את ההודעה…',
    'opt.feedback.contact.ph': 'מייל לחזרה (לא חובה)',
    'opt.feedback.send': 'שלח',
    'opt.feedback.sending': 'שולח…',
    'opt.feedback.sent': '✅ תודה! הפידבק נשלח אליי.',
    'opt.feedback.empty': 'כתוב הודעה לפני השליחה.',
    'opt.feedback.failed': '⚠️ השליחה נכשלה. נסה שוב, או דרך GitHub.',
    'opt.feedback.notset': 'טופס הפידבק עדיין לא הוגדר — בינתיים אפשר דרך GitHub Issues.',
    'opt.feedback.github': 'פתח GitHub Issues',

    // Activity type labels (options page file-type picker)
    'ft.resource': 'קובץ (Resource)',
    'ft.folder': 'תיקייה (Folder)',
    'ft.assign': 'מטלה (Assignment)',
    'ft.url': 'קישור (URL)',
    'ft.page': 'דף (Page)',
    'ft.book': 'ספר (Book)',
    'ft.quiz': 'בוחן (Quiz)',
    'ft.lesson': 'שיעור (Lesson)',
    'ft.forum': 'פורום (Forum)',
    'ft.chat': 'צ׳אט (Chat)',
    'ft.feedback': 'משוב (Feedback)',
    'ft.choice': 'בחירה (Choice)',
    'ft.wiki': 'ויקי (Wiki)',
    'ft.glossary': 'מילון (Glossary)',
    'ft.workshop': 'סדנה (Workshop)',
    'ft.scorm': 'SCORM',
    'ft.h5pactivity': 'H5P',

    // ----- Popup: remaining static UI -----
    'pop.queue.count': '{n} פריטים בתור',
    'pop.queue.suffix': ' · הורד הכל כ-ZIP',
    'pop.queue.clear': 'נקה תור',
    'pop.deadlines.mycourses.html': '💡 כדי להוריד קבצי קורסים — עבור ל<a href="https://moodlearn.ariel.ac.il/my/courses.php" target="_blank" style="color: var(--accent); font-weight: 600;">דף "הקורסים שלי"</a> ולחץ שוב על אייקון התוסף.',
    'pop.zoom.links': '📄 קישורים ותמלילים',
    'pop.zoom.videos': '🎥 הורד סרטונים (MP4)',
    'pop.zoom.hint': 'קישורים ותמלילים 📄 — ZIP מהיר עם הכל. סרטונים 🎥 — קבצי MP4 של ההקלטות (200MB עד 2GB לכל אחת), ממשיך ברקע גם אחרי סגירה. הווידאו יורד באיכות הגבוהה ביותר ש-Zoom חושף. אם Windows לא מצליח לפתוח — נסה VLC.',
    'pop.zoom.debug.summary': '🩺 משהו לא עובד? פתח כלי אבחון',
    'pop.zoom.debug.network': '🎬 תיעוד בקשות רשת לאיתור תקלות (איטי — כ-25 שניות לכל הקלטה)',
    'pop.zoom.debug.diagnose': '🩺 דיאגנוסטיקה קצרה',
    'pop.zoom.debug.research': '🔬 מחקר עמוק',
    'pop.zoom.debug.hint': 'פתח רק כשמשהו נכשל. דיאגנוסטיקה — בודקת שלב אחר שלב את כל הצנרת. מחקר עמוק — מקליט trace רשת מלא באמצעות <code dir="ltr">chrome.debugger</code>.',
    'pop.zoom.debug.copy': '📋 העתק הכל',

    // ----- Time-saved counter (options page) -----
    'opt.section.stats': 'כמה זמן חסכתי לך',
    'opt.stats.headline': 'חסכת בערך {time}',
    'opt.stats.sub': '{items} פריטים מתוך {n} הורדות',
    'opt.stats.note': 'הערכה גסה: ~{sec} שניות לפריט שאחרת היית מוריד ידנית',
    'opt.stats.none': 'עוד לא הורדת כלום — המונה יתחיל לרוץ אחרי ההורדה הראשונה.',
    'opt.stats.time.hm': '{h} שעות ו-{m} דקות',
    'opt.stats.time.m': '{m} דקות',

    // ----- Updates section + banner -----
    'opt.section.updates': 'עדכונים',
    'opt.updates.desc': 'בדיקה אוטומטית אם יצאה גרסה חדשה ב-GitHub',
    'opt.updates.check.name': 'בדיקת עדכונים אוטומטית',
    'opt.updates.check.hint': 'בכל פתיחה (לכל היותר אחת לכמה שעות) נבדק אם קיימת גרסה חדשה. זו בקשת GET לקובץ ציבורי ב-GitHub — לא נשלח שום מידע אישי.',
    'opt.updates.current': 'גרסה מותקנת',
    'opt.updates.checknow': 'בדוק עכשיו',
    'opt.updates.checking': 'בודק…',
    'opt.updates.uptodate': '✅ אתה מעודכן (גרסה {v})',
    'opt.updates.available': '🆕 גרסה חדשה {v} זמינה!',
    'opt.updates.failed': '⚠️ בדיקת העדכון נכשלה — בדוק חיבור לאינטרנט.',
    'opt.updates.howto': 'עדכון בלחיצה: <strong>⬇️ עדכן עכשיו</strong> ואז <strong>🔄 רענן</strong>. (פעם ראשונה? הרץ <code>native-host\\install.bat</code> בתיקיית התוסף.)',
    'opt.updates.openext': 'פתח דף תוספים',
    'opt.updates.runnow': '⬇️ עדכן עכשיו',
    'opt.updates.updating': '⏳ מעדכן…',
    'opt.updates.updated': '✅ עודכן ל-{v} — לחץ 🔄 רענן עכשיו',
    'opt.updates.alreadylatest': '✅ כבר בגרסה האחרונה ({v}).',
    'opt.updates.updatefailed': '⚠️ העדכון נכשל: {msg}',
    'opt.updates.nohost': '⚙️ צריך התקנה חד-פעמית: הרץ <code>native-host\\install.bat</code> בתיקיית התוסף, סגור ופתח את הדפדפן, ונסה שוב.',
    'opt.updates.reloadnow': '🔄 רענן עכשיו',
    'opt.updates.changelog': 'מה חדש',
    'pop.update.available': '🆕 גרסה חדשה {v} זמינה — הרץ update.bat ואז לחץ 🔄 רענן עכשיו.',

    // ----- First-run disclaimer / consent -----
    'disc.title': 'לפני שמתחילים',
    'disc.body': 'Moodle Hoarder הוא כלי <strong>לא רשמי</strong>, שאינו קשור לאוניברסיטת אריאל או לכל מוסד אחר.',
    'disc.li1': 'הכלי מיועד <strong>לשימוש אישי בלבד</strong> — להורדת חומרי הקורסים שלך. אין להפיץ מחדש חומרים המוגנים בזכויות יוצרים.',
    'disc.li2': 'ייתכן שהורדה אוטומטית בכמות נוגדת את תנאי השימוש של המוסד — באחריותך לוודא שאתה עומד בהם.',
    'disc.li3': 'הכלי ניתן כמות-שהוא (AS IS), ללא אחריות, והמפתח אינו אחראי לכל שימוש שנעשה בו.',
    'disc.accept': 'הבנתי, אני מסכים/ה',
  },
  en: {
    'app.title': 'Moodle Hoarder',
    'app.tagline': 'Hoards everything from Moodle into one ZIP',
    'app.settings.title': 'Settings',
    'options.header.title': 'Moodle Hoarder — Settings',
    'options.header.sub': 'All the toggles and options in one place',

    'btn.scan': 'Scan',
    'btn.back': 'Back',
    'btn.download.zip': 'Download ZIP',
    'btn.download.all': 'Download all selected courses',
    'btn.select.all': 'All',
    'btn.select.none': 'None',
    'btn.select.defaults': 'Reset',
    'btn.export.deadlines': 'Export to calendar',
    'btn.decode.zoom': 'Decode links & download',
    'btn.only.new': 'Only new',

    'initial.hint': 'Open a Moodle course page (course/view.php) or your courses page (my/courses.php) and click "Scan".',

    'picker.search.placeholder': 'Search...',
    'picker.selected.of': 'of',
    'picker.selected.suffix': 'selected',
    'picker.expand.all.title': 'Expand/collapse all',

    'multi.found.prefix': 'Found',
    'multi.found.suffix': 'courses in "My courses" page.',
    'multi.search.placeholder': 'Search course...',
    'multi.only.new': 'Download only new files per course',

    'deadlines.found.prefix': 'Found',
    'deadlines.found.suffix': 'assignments (excluding hidden).',
    'deadlines.help.ical': 'Pick which assignments to include in the calendar file. After download — double-click to add them to Google Calendar / Outlook / Apple Calendar.',
    'deadlines.help.mycourses': '💡 To download course files — go to the "My courses" page and click the extension icon again.',

    'zoom.found.prefix': 'Found',
    'zoom.found.suffix': 'recordings. Pick which to resolve URLs for:',
    'zoom.search.placeholder': 'Search recordings...',
    'zoom.selected.suffix': 'selected',

    'opt.section.appearance': 'Appearance',
    'opt.section.zip': 'ZIP structure',
    'opt.section.download': 'Download',
    'opt.section.content': 'Content',
    'opt.section.rightclick': 'Right-click',
    'opt.section.history': 'History',
    'opt.section.reset': 'Reset',
    'opt.section.language': 'Interface language',

    'opt.lang.title': 'Interface language',
    'opt.lang.hint': '"Auto" picks the language based on the open Moodle course (using the <code>&lt;html lang&gt;</code> tag). Otherwise — manual.',
    'opt.lang.auto': 'Auto',
    'opt.lang.he': 'עברית',
    'opt.lang.en': 'English',

    'status.saved': 'Saved',
    'status.scanning': 'Scanning...',
    'status.downloading': 'Downloading...',
    'status.zipping': 'Building ZIP...',
    'status.done': 'Done',
    'status.error': 'Error',

    'status.opening.activities': 'Opening all activities...',
    'status.scanning.deadlines': 'Scanning deadlines...',
    'status.no.deadlines': 'No assignments found. Make sure "Timeline" is loaded and try again.',
    'status.error.with.message': 'Error: {msg}',
    'status.downloading.queue': 'Downloading {n} queued items...',
    'status.queue.failed': 'Queue download failed.',
    'status.zipping.bundle': 'Packaging ZIP...',
    'status.completed.with.count': 'Done: {n} items, {size}.',
    'status.checking.page': 'Checking page...',
    'status.waiting.zoom': 'Waiting for the Zoom page to load...',
    'status.no.zoom': 'No recordings found. See the downloaded file for details.',
    'status.scanning.courses': 'Scanning courses...',
    'status.no.courses': 'No courses found. Scroll down so all courses load, then retry.',
    'status.scanning.course': 'Scanning course...',
    'status.no.items': 'No items found on the page.',
    'status.wrong.page': 'Please open a Moodle course page or the "My courses" page.',
    'status.zoom.start': 'Resolving URLs for {n} recordings — do not close!',
    'status.zoom.no.urls': 'No URLs found. Download the zoom-detail-debug HTML too.',
    'status.zoom.results': 'Done: {ok}/{total} URLs resolved.',
    'status.completed': 'Done.',
    'status.downloading.parallel': 'Downloading {n} items in parallel (up to {c} at a time)...',
    'status.no.deadlines.selected': 'Pick at least one assignment with a due date.',
    'status.exported.deadlines': 'Exported {n} assignments to ICS.',
    'log.nothing.to.download': '— {name}: nothing to download',
    'log.course.items': '✓ {name}: {n} items',
    'log.grades.failed': '✗ Grades fetch: {msg}',
    'err.no.active.tab': 'No active tab',
    'err.file.not.found': 'No file found',
    'err.folder.empty': 'Empty / blocked folder',

    'queue.clear.confirm': 'Empty the queue?',
    'notif.queue.done': '{n} queued items downloaded',
    'notif.multi.done': 'Finished downloading {n} courses',
    'notif.course.done': 'Downloaded {n} items from "{name}"',
    'size.over.tooltip': 'Over {mb}MB — marked red and unchecked. You can still check it manually.',
    'size.checking': 'Checking file sizes…',
    'size.checking.progress': 'Checking file sizes… {done}/{total}',
    'size.summary.over': '{n} files over {mb}MB were marked red and unchecked — you can re-check manually.',
    'diff.checkpoint': 'Incomplete download from {date} found ({n} items already saved). They will be kept and the download will resume.',
    'diff.previous': 'Previous download from {date} — {n} new items since.',
    'diff.chip.new': 'new',
    'diff.chip.notdefault': 'non-default',
    'multi.pin.title': 'Unpin',
    'multi.unpin.title': 'Pin to top',

    'dash.hide': 'Hide',
    'dash.hide.title': 'Hide this assignment (Moodle Hoarder)',
    'dash.unhide': 'Restore',
    'dash.unhide.title': 'Restore this assignment to the list',
    'dash.clear.all': 'Clear all',
    'dash.clear.all.title': 'Restore all hidden assignments to the list',
    'dash.clear.all.confirm': 'Restore all {n} hidden assignments?',
    'dash.count.hidden': '{n} assignments hidden',
    'dash.show.hidden': 'Show hidden',
    'dash.hide.again': 'Hide again',

    // ----- Options page: full section copy -----
    'opt.lang.desc': 'Choose the extension UI language (does not affect course content)',

    'opt.appearance.desc': 'Light / dark / follow the OS setting',
    'opt.theme.name': 'Theme',
    'opt.theme.hint': '"Auto" follows the dark-mode setting of Windows/macOS. "Light" / "Dark" force it manually.',
    'opt.theme.auto': 'Auto',
    'opt.theme.light': 'Light',
    'opt.theme.dark': 'Dark',
    'opt.accent.name': 'Accent color',
    'opt.accent.hint': '"Orange-pink" is the extension default. "Ariel blue" matches Ariel University’s palette.',
    'opt.accent.orangepink': 'Orange-pink',
    'opt.accent.blue': 'Ariel blue',
    'opt.compact.name': 'Compact mode',
    'opt.compact.hint': 'Items in one small row instead of two. Handy for big courses with many items.',

    'opt.zip.desc': 'How to organize the files inside the downloaded ZIP',
    'opt.zip.layout.name': 'Layout',
    'opt.zip.layout.hint': '"By sections" creates a folder per Moodle section. "All together" puts every file in one flat folder. "Both" produces both structures in the same ZIP (default, twice the size).',
    'opt.zip.sections': 'By sections',
    'opt.zip.flat': 'All together',
    'opt.zip.both': 'Both',

    'opt.download.desc': 'Where and how files are saved',
    'opt.saveas.name': '"Save As" — choose where to save',
    'opt.saveas.hint': 'Every download opens a Chrome dialog to pick a location. Off by default — files go straight to the Downloads folder.',
    'opt.subfolder.name': 'Subfolder inside Downloads',
    'opt.subfolder.hint': 'e.g. <code>Moodle/2026-spring/</code> — Chrome doesn’t allow an absolute path from an extension, but you can create a subfolder inside Downloads. Leave empty to save directly in Downloads.',

    'opt.content.desc': 'Which activities to include in the download',
    'opt.grades.name': 'Include grades',
    'opt.grades.hint': 'Fetches the course Grader Report and adds it to the ZIP as <code>grades.csv</code>. <strong>Note — when you share the ZIP, your grades are included too.</strong> Off by default.',
    'opt.json.name': 'Include <code>course.json</code>',
    'opt.json.hint': 'Adds a structured JSON file with the full course layout — sections, items, types, URLs, file sizes, errors. Useful for integrations with Notion / Anki / Sheets / scripts. Small (~10-50KB), excludes the files themselves. On by default.',
    'opt.maxsize.name': 'File size threshold (MB)',
    'opt.maxsize.hint': 'Files larger than the threshold are not checked by default in the course picker — you get a warning and can check them manually. <code>0</code> = disabled (all files selected as usual).',
    'opt.filetypes.name': 'Activity types checked by default',
    'opt.filetypes.hint': 'When scanning a course, these activities are auto-checked. You can still choose manually per course.',

    'opt.zoom.desc': 'Zoom recording settings (apply only when a Zoom Recordings page is opened in Ariel)',
    'opt.zoom.video.name': 'Downloading the video files (MP4)',
    'opt.zoom.video.hint': 'The recordings themselves are downloaded via the 🎥 <strong>"Download videos"</strong> button that appears after scanning the Zoom page — no toggle needed here. Each recording is saved separately in Downloads (or in the subfolder you set). Large files — 200MB to 2GB each. The download continues in the background even if you close the popup.',
    'opt.zoom.video.control': 'Via the 🎥 button',
    'opt.zoom.transcripts.name': 'Automatic transcript extraction',
    'opt.zoom.transcripts.hint': 'After resolving recording URLs, the extension opens each one in a background tab and grabs the VTT (Zoom’s auto transcript). If turned off — you only get a text file with the links, no ZIP. <strong>Recordings without a transcript are skipped after 8 seconds</strong> (it checks for transcript UI on the page).',
    'opt.zoom.format.name': 'Transcript format',
    'opt.zoom.format.hint': '"Both" — the original <code>.vtt</code> (with timestamps, works as subtitles over video) and a clean readable <code>.txt</code> (with speakers and paragraphs). "Text only" / "VTT only" make the ZIP smaller.',
    'opt.zoom.format.both': 'Both',
    'opt.zoom.format.txt': 'Text only',
    'opt.zoom.format.vtt': 'VTT only',
    'opt.zoom.concurrency.name': 'Parallel recordings',
    'opt.zoom.concurrency.hint': 'How many transcripts to extract at once. 3 is a good balance of speed and load. Higher (4-5) may make Zoom throttle or strain your machine. Range: 1-5.',

    'opt.rightclick.desc': 'Behavior of the "Download with Moodle Hoarder" menu',
    'opt.rightclick.action.name': 'Action',
    'opt.rightclick.action.hint': '"Immediate" — download the file right away. "Queue" — add to a list and download them all as one ZIP at the end. "Ask" — a short menu on each click.',
    'opt.rightclick.immediate': 'Immediate',
    'opt.rightclick.queue': 'Queue',
    'opt.rightclick.ask': 'Ask',
    'opt.rightclick.saveas.name': '"Save As" on right-click',
    'opt.rightclick.saveas.hint': 'Open a location-picker dialog on every right-click download (even when the global toggle is off).',

    'opt.history.desc': 'All recent downloads — courses, links/transcripts and Zoom videos. Clicking reopens the download source when a link exists.',
    'opt.history.clear': 'Clear history',
    'opt.history.col.download': 'Download',
    'opt.history.col.type': 'Type',
    'opt.history.col.items': 'Items',
    'opt.history.col.status': 'Status',
    'opt.history.col.size': 'Size',
    'opt.history.col.date': 'Date',
    'opt.history.col.action': 'Action',
    'opt.history.empty': 'You haven’t downloaded any course or recording yet',
    'opt.history.open': 'Open',
    'opt.history.counts': '{ok}/{total} ({failed} failed)',
    'opt.history.fallback': 'Download',
    'opt.history.legacy.course': 'Course {id}',
    'opt.history.type.course': 'Course ZIP',
    'opt.history.type.zoomlinks': 'Zoom links/transcripts',
    'opt.history.type.zoomvideos': 'Zoom videos',
    'opt.history.type.legacy': 'Course (legacy diff)',
    'opt.history.status.success': 'Success',
    'opt.history.status.partial': 'Partial',
    'opt.history.status.failed': 'Failed',
    'opt.history.clear.confirm': 'Delete all your course download history? (won’t delete files already downloaded)',

    'opt.reset.desc': 'Reset all settings to their defaults',
    'opt.reset.name': 'Reset',
    'opt.reset.hint': 'Resets all settings to their default values. Doesn’t affect history or diff state.',
    'opt.reset.btn': 'Reset settings',
    'opt.reset.confirm': 'Reset all settings to defaults?',

    'opt.about.title': 'About',
    'opt.about.story': 'Moodle Hoarder was born out of frustration — a bunch of students fed up with downloading every file one by one and fighting a slow, clunky Moodle decided to simply turn it into one efficient tool that grabs the whole course in a single click.',
    'opt.about.copy': '© {year} E.A — all rights reserved.',
    'opt.about.feedback': 'Report a bug or suggest an improvement',
    'opt.about.donate': '☕ Buy me a coffee',

    // Feedback form
    'opt.section.feedback': '💬 Feedback & suggestions',
    'opt.feedback.desc': 'Found a bug? Have a feature idea? Write to me here and it reaches me directly.',
    'opt.feedback.type.label': 'Type',
    'opt.feedback.type.bug': '🐞 Bug',
    'opt.feedback.type.feature': '💡 Feature request',
    'opt.feedback.type.other': '💬 Other',
    'opt.feedback.message.ph': 'Write your message here…',
    'opt.feedback.contact.ph': 'Email for a reply (optional)',
    'opt.feedback.send': 'Send',
    'opt.feedback.sending': 'Sending…',
    'opt.feedback.sent': '✅ Thanks! Your feedback was sent.',
    'opt.feedback.empty': 'Write a message before sending.',
    'opt.feedback.failed': '⚠️ Sending failed. Try again, or via GitHub.',
    'opt.feedback.notset': 'The feedback form isn’t set up yet — for now use GitHub Issues.',
    'opt.feedback.github': 'Open GitHub Issues',

    // Activity type labels (options page file-type picker)
    'ft.resource': 'File (Resource)',
    'ft.folder': 'Folder',
    'ft.assign': 'Assignment',
    'ft.url': 'Link (URL)',
    'ft.page': 'Page',
    'ft.book': 'Book',
    'ft.quiz': 'Quiz',
    'ft.lesson': 'Lesson',
    'ft.forum': 'Forum',
    'ft.chat': 'Chat',
    'ft.feedback': 'Feedback',
    'ft.choice': 'Choice',
    'ft.wiki': 'Wiki',
    'ft.glossary': 'Glossary',
    'ft.workshop': 'Workshop',
    'ft.scorm': 'SCORM',
    'ft.h5pactivity': 'H5P',

    // ----- Popup: remaining static UI -----
    'pop.queue.count': '{n} items queued',
    'pop.queue.suffix': ' · Download all as ZIP',
    'pop.queue.clear': 'Clear queue',
    'pop.deadlines.mycourses.html': '💡 To download course files — go to the <a href="https://moodlearn.ariel.ac.il/my/courses.php" target="_blank" style="color: var(--accent); font-weight: 600;">"My courses" page</a> and click the extension icon again.',
    'pop.zoom.links': '📄 Links & transcripts',
    'pop.zoom.videos': '🎥 Download videos (MP4)',
    'pop.zoom.hint': 'Links & transcripts 📄 — a quick ZIP with everything. Videos 🎥 — the recordings’ MP4 files (200MB to 2GB each), continues in the background even after you close it. Video downloads at the highest quality Zoom exposes. If Windows can’t open it — try VLC.',
    'pop.zoom.debug.summary': '🩺 Something not working? Open diagnostics',
    'pop.zoom.debug.network': '🎬 Log network requests for troubleshooting (slow — ~25 seconds per recording)',
    'pop.zoom.debug.diagnose': '🩺 Quick diagnostics',
    'pop.zoom.debug.research': '🔬 Deep research',
    'pop.zoom.debug.hint': 'Open only when something fails. Diagnostics — checks the whole pipeline step by step. Deep research — records a full network trace via <code dir="ltr">chrome.debugger</code>.',
    'pop.zoom.debug.copy': '📋 Copy all',

    // ----- Time-saved counter (options page) -----
    'opt.section.stats': 'Time you saved',
    'opt.stats.headline': 'You saved roughly {time}',
    'opt.stats.sub': '{items} items across {n} downloads',
    'opt.stats.note': 'Rough estimate: ~{sec}s per item you’d otherwise download by hand',
    'opt.stats.none': 'Nothing downloaded yet — the counter starts after your first download.',
    'opt.stats.time.hm': '{h}h {m}m',
    'opt.stats.time.m': '{m}m',

    // ----- Updates section + banner -----
    'opt.section.updates': 'Updates',
    'opt.updates.desc': 'Automatically check GitHub for a newer version',
    'opt.updates.check.name': 'Automatic update check',
    'opt.updates.check.hint': 'On open (at most once every few hours) the extension checks GitHub for a newer version. It is a GET of a public file — no personal data is sent.',
    'opt.updates.current': 'Installed version',
    'opt.updates.checknow': 'Check now',
    'opt.updates.checking': 'Checking…',
    'opt.updates.uptodate': '✅ You’re up to date (v{v})',
    'opt.updates.available': '🆕 New version {v} available!',
    'opt.updates.failed': '⚠️ Update check failed — check your connection.',
    'opt.updates.howto': 'One-click update: <strong>⬇️ Update now</strong> then <strong>🔄 Reload</strong>. (First time? run <code>native-host\\install.bat</code> in the extension folder.)',
    'opt.updates.openext': 'Open extensions page',
    'opt.updates.runnow': '⬇️ Update now',
    'opt.updates.updating': '⏳ Updating…',
    'opt.updates.updated': '✅ Updated to {v} — click 🔄 Reload now',
    'opt.updates.alreadylatest': '✅ Already on the latest version ({v}).',
    'opt.updates.updatefailed': '⚠️ Update failed: {msg}',
    'opt.updates.nohost': '⚙️ One-time setup needed: run <code>native-host\\install.bat</code> in the extension folder, restart the browser, and try again.',
    'opt.updates.reloadnow': '🔄 Reload now',
    'opt.updates.changelog': 'What’s new',
    'pop.update.available': '🆕 New version {v} available — run update.bat then click 🔄 Reload now.',

    // ----- First-run disclaimer / consent -----
    'disc.title': 'Before you start',
    'disc.body': 'Moodle Hoarder is an <strong>unofficial</strong> tool, not affiliated with Ariel University or any institution.',
    'disc.li1': 'It is for <strong>personal use only</strong> — to download your own course materials. Do not redistribute copyrighted materials.',
    'disc.li2': 'Bulk automated downloading may conflict with your institution’s terms of use — it is your responsibility to comply with them.',
    'disc.li3': 'The tool is provided AS IS, without warranty, and the developer is not responsible for how it is used.',
    'disc.accept': 'I understand and agree',
  },
};

// LocalStorage mirror so the inline theme-bootstrap (and any pre-paint
// language application) can read the resolved language synchronously.
const MH_LANG_LS_KEY = 'mh-lang';

// Currently active language. Defaults to Hebrew (matches the static HTML).
let MH_CURRENT_LANG = 'he';

// Detect a sensible "auto" language. Order:
//   1. <html lang> of the active Moodle tab, if reachable (caller can pass it).
//   2. navigator.language prefix.
//   3. 'he' as the safe default for this extension's user base.
function detectAutoLanguage(courseLang) {
  if (courseLang && typeof courseLang === 'string') {
    const lc = courseLang.toLowerCase();
    if (lc.startsWith('he') || lc.startsWith('iw')) return 'he';
    if (lc.startsWith('en')) return 'en';
  }
  try {
    const nav = (navigator.language || '').toLowerCase();
    if (nav.startsWith('he') || nav.startsWith('iw')) return 'he';
    if (nav.startsWith('en')) return 'en';
  } catch {}
  return 'he';
}

// Resolves the effective language given the user's setting and (optional)
// course language hint. Caller is responsible for fetching the course lang
// from the active tab if it wants 'auto' to be tab-aware.
function resolveLanguage(uiLanguageSetting, courseLang) {
  if (uiLanguageSetting === 'he' || uiLanguageSetting === 'en') return uiLanguageSetting;
  return detectAutoLanguage(courseLang);
}

// Translate a key with optional `{var}` substitution.
//   t('foo')                  → 'Hello'
//   t('foo', { n: 5 })        → 'Hello 5' (when 'foo' = 'Hello {n}')
// Falls back to English then to the key itself.
function t(key, vars) {
  const lang = MH_CURRENT_LANG;
  let str = (MH_STRINGS[lang] && MH_STRINGS[lang][key])
        || (MH_STRINGS.en && MH_STRINGS.en[key])
        || key;
  if (vars && typeof str === 'string') {
    str = str.replace(/\{(\w+)\}/g, (m, name) => (name in vars ? vars[name] : m));
  }
  return str;
}

// Apply the language to <html lang>, <html dir>, and all elements with
// data-i18n / data-i18n-attr attributes. Idempotent; safe to call again
// when the language setting changes.
function applyLanguage(lang) {
  MH_CURRENT_LANG = lang || 'he';
  try { localStorage.setItem(MH_LANG_LS_KEY, MH_CURRENT_LANG); } catch {}
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('lang', MH_CURRENT_LANG);
  root.setAttribute('dir', MH_CURRENT_LANG === 'he' ? 'rtl' : 'ltr');

  // Text content. If a node has children other than plain text, we'd
  // wipe them — so guard against that by only touching nodes whose
  // textContent equals the concatenation of their immediate text.
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const str = t(key);
    // Allow markup-bearing values via data-i18n-html="1"
    if (el.dataset.i18nHtml === '1') {
      el.innerHTML = str;
    } else {
      el.textContent = str;
    }
  });
  // Attribute bindings: "attr:key, attr:key"
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    const spec = el.getAttribute('data-i18n-attr');
    if (!spec) return;
    for (const pair of spec.split(',')) {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (!attr || !key) continue;
      el.setAttribute(attr, t(key));
    }
  });
}

// Expose to whichever context loaded us.
if (typeof self !== 'undefined') {
  self.MH_STRINGS = MH_STRINGS;
  self.t = t;
  self.applyLanguage = applyLanguage;
  self.resolveLanguage = resolveLanguage;
  self.detectAutoLanguage = detectAutoLanguage;
  self.MH_LANG_LS_KEY = MH_LANG_LS_KEY;
}
