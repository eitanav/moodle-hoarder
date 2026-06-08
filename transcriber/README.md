# Moodle Hoarder Transcriber MVP

<div dir="rtl">

כלי תמלול מקומי ונפרד מהתוסף: גוררים/בוחרים הקלטת קורס, בוחרים מודל Whisper, ומקבלים תמלול עברי בפורמטים שמתאימים גם לבן אדם וגם ל-LLM.

> סטטוס: MVP ראשון לבדיקה. לא נוגע בקוד הורדת ה-Zoom של התוסף.

## מה זה מוציא

לכל קובץ `lecture.mp4` נוצרת תיקיית `transcripts/` עם:

- `lecture.txt` — טקסט קריא עם timestamps.
- `lecture.srt` — כתוביות SubRip.
- `lecture.vtt` — כתוביות WebVTT.
- `lecture.json` — JSON עם schema, שם מקור, מודל, שפה ו-segments עם `start`/`end`/`text`.

## האם RTX 3070 Laptop מספיק?

כן. ברוב המחשבים עם NVIDIA RTX 3070 Laptop יש בדרך כלל 8GB VRAM, וזה אמור להספיק טוב ל-`large-v3-turbo` עם `cuda` + `float16`. אם יש שגיאת זיכרון, נסה לפי הסדר:

1. להשאיר מודל `large-v3-turbo` ולהחליף `Compute` ל-`int8_float16`.
2. לעבור למודל `medium`.
3. לעבור ל-`Device=cpu` ו-`Compute=int8` — איטי יותר אבל אמור לעבוד.

## עדכון דרך update.bat

אם `update.bat` נתקע על מחיקת `transcriber/.venv/.../ctranslate2.dll`, זה אומר ש-Python/GUI עדיין מחזיק את הקובץ פתוח. סגור את חלון התמלול וכל תהליך Python שרץ, לחץ `n` או סגור את חלון ה-CMD, ואז הרץ שוב את `update.bat`. המעדכן המעודכן שומר את `.venv` המקומי ולא מנסה למחוק אותו.

## התקנה והרצת GUI ב-Windows

הדרך הכי פשוטה: להיכנס לתיקיית `transcriber` וללחוץ דאבל-קליק על:

```text
run_gui_windows.bat
```

הקובץ הזה יוצר `.venv` אם צריך, מתקין `faster-whisper` אם הוא חסר, ואז פותח את ה-GUI. אם אתה מקבל שגיאה על dependency חסר, זה כמעט תמיד אומר שהרצת `python run_gui.py` מסביבת Python אחרת במקום דרך `run_gui_windows.bat`.

התקנה ידנית, אם אתה מעדיף PowerShell:

```powershell
cd transcriber
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python run_gui.py
```

> בפעם הראשונה המודל יורד מהאינטרנט. אחרי זה הוא נשמר ב-cache של Hugging Face/CTranslate2.

### איך יודעים שזה מתקדם?

אם הלוג מראה `Loading model large-v3-turbo on cuda (float16)`, הכלי עדיין טוען/מוריד את המודל ומאתחל CUDA. בפעם הראשונה זה יכול לקחת כמה דקות בלי אחוזי התקדמות. אחרי שהמודל נטען תראה `Model loaded`.

בגרסה הנוכחית שלב `Preparing audio with ffmpeg before transcription` מופיע לפני טעינת המודל, עם התקדמות `Prepared audio ... (%)`. זה שלב CPU/דיסק שממיר MP4/M4A/WAV לקובץ WAV פשוט של 16kHz כדי למנוע תקיעה שקטה בקריאת קובצי וידאו ארוכים. אחריו מגיע שלב טעינת המודל, ואם הוא ארוך תראה הודעות `Still loading model ...` כל 30 שניות. רק אחרי `Model loaded` תראה שורות `Decoded ... (%)` לפי הזמן שכבר תומלל מתוך ההקלטה.

חשוב: בתחילת הריצה יכול להיות שה-GPU כמעט לא מתאמץ כי הורדת המודל, טעינת הקובץ, המרת ffmpeg, VAD וחלק מההכנה רצים בעיקר על CPU/דיסק. כששורות `Decoded ...` מתחילות, אמורה להיות קפיצה ב-`Dedicated GPU memory`/VRAM, ולעיתים גם קפיצות קצרות ב-`GPU utilization`. אם VRAM עולה בכמה GB זה סימן חזק שהמודל יושב על הכרטיס גם אם האחוזים ב-Task Manager נראים נמוכים.

כדי לבדוק ישירות מתוך התוכנה, לחץ על הכפתור `בדוק GPU` או הרץ CLI:

```powershell
python transcribe.py --diagnose-gpu
```

ברירת המחדל מותאמת למחשב שלך: `Device=cuda`, `Compute=float16`, מודל `large-v3-turbo`, שפה `he`. אם זה עדיין לא מגיע ל-`Decoded`, לחץ `מצב בדיקה` כדי להריץ פעם אחת עם `model=base`; אם `base` עובד, הבעיה היא הורדה/טעינה של `large-v3-turbo` ולא כל הצינור.

אם `tkinterdnd2` מותקן, אפשר לגרור קובץ לשדה. גם בלי drag-and-drop אפשר ללחוץ "בחר קובץ".

## הרצת CLI

```powershell
cd transcriber
.\.venv\Scripts\Activate.ps1
python transcribe.py "C:\path\to\lecture.mp4" --device cuda --compute-type float16 --model large-v3-turbo --language he
```

ברירת המחדל מכינה קודם WAV זמני עם ffmpeg. אם אתה רוצה לחזור להתנהגות הישנה ולשלוח את הקובץ ישירות ל-`faster-whisper`, הוסף `--no-preprocess-audio`.

אפשר לבחור תיקיית פלט:

```powershell
python transcribe.py "C:\path\to\lecture.mp4" --out "C:\path\to\course\transcripts"
```

## מודלים מומלצים

- `large-v3-turbo` — ברירת מחדל מומלצת: איכות טובה ומהיר יותר מ-large-v3.
- `large-v3` — איכות גבוהה יותר בחלק מהמקרים, כבד יותר.
- `medium` — fallback טוב אם חסר VRAM.
- `small` / `base` — בדיקות מהירות או מחשבים חלשים.

## מגבלות MVP

- אין עדיין צ'אט על הקורס.
- אין עדיין diarization / זיהוי דוברים.
- אין עדיין חיבור אוטומטי ל-ZIP/recordings של התוסף.
- אין עדיין resume ל-chunks ארוכים. זה השלב הבא לפני תמלול מאסיבי של עשרות שעות.

## השלב הבא המומלץ

1. לבדוק על הקלטה אמיתית של 10–20 דקות.
2. לבדוק על הקלטה של שעה.
3. אם האיכות טובה — להוסיף chunking+resume.
4. אחר כך להוסיף ניקוי/סיכום עם LLM ו-JSON שמתאים ל"שאל את הקורס".

</div>
