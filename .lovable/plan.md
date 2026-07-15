
## הבעיה

הודעה: **"תשלום בדואר עבור גשר הזמין תהילה הערה 5 שח עמלה"**

- `עבור גשר` = הלקוח (יש כינוי "גשר" → `גשר חפירה וחציבה בע"מ`).
- `הזמין תהילה` = איש הקשר שהזמין (במקרה הזה תהילה מהמשרד של גשר).

בעיה: במאגר קיים גם כינוי "תהילה" ללקוח אחר (`עוד רוני כהן`) — זה כינוי לגיטימי לשימוש עתידי. `resolveClientId` הנוכחי סורק את כל הטקסט, מוצא שני כינויים תואמים ("גשר" + "תהילה"), מכריז על עמימות ומחזיר `missing_client`.

הכלל הסמנטי הנכון: **המילה שאחרי `"עבור"` היא הלקוח. המילה שאחרי `"הזמין"/"הזמינה"` היא איש הקשר — לא לקוח, גם אם היא כינוי של לקוח אחר.**

## התיקון

### 1. חוק "עבור" / "הזמין" ב-`resolveClientId` (`src/lib/processing.server.ts`)

לפני כל שאר ה-fallbacks:

1. **חילוץ עוגנים** בטקסט המקורי:
   - `afterAvur` = הטוקן/ים מיד אחרי `עבור` / `בשביל` (עוצר בפסיק, נקודה, "הזמין", "הערה", מספר, סוף שורה).
   - `afterHizmin` = הטוקן/ים מיד אחרי `הזמין` / `הזמינה` / `ביקש` / `ביקשה`.
2. **בחירת לקוח מ־`afterAvur`:** אם התאמה מדויקת לשם/כינוי → החזר מיידית, גם אם `afterHizmin` הוא כינוי של לקוח אחר.
3. **מיסוך `afterHizmin`:** הטוקנים האלה מוסרים מ-`textTokenList` לפני fallback 1 ו-2, כך שכינוי בהקשר "הזמין X" לא יתחזה ללקוח.
4. הפאלבקים הקיימים נשארים כגיבוי.

### 2. חיזוק ה-AI עם רשימת לקוחות + כינויים

- ב-`processIncomingMessage` נטען פעם אחת את `clients` + `client_aliases` של המשתמש, ונעביר ל-`callLovableAI`.
- ב-`SYSTEM_PROMPT` נוסיף כלל:
  - "המילה מיד אחרי `עבור` היא `client_name`. המילה מיד אחרי `הזמין`/`הזמינה` היא `contact_ordered_by` — **אף פעם לא `client_name`, גם אם היא נראית כשם לקוח מוכר**."
  - "`client_name` חייב להיות אחד מהשמות/כינויים הבאים בדיוק (או `null`)."
- ב-user prompt נוסיף בלוק `KNOWN_CLIENTS` (שם → כינויים).

### 3. הרצה מחדש — **רק להודעות בסטטוס `missing_client`**

אחרי הפריסה, אאתר את כל ההודעות של המשתמש בסטטוס `missing_client` ואריץ להן `processIncomingMessage` מחדש (בסידרה, עם השהיה קלה בין הרצות כדי לא להעמיס על AI Gateway ו-Google Sheets):

- שאילתה: `SELECT id FROM incoming_messages WHERE status='missing_client' AND user_id=<אילת>`.
- לכל id: לקרוא ל-`processIncomingMessage(supabaseAdmin, id)`.
- **לא** נוגעים בהודעות בסטטוס `done`, `failed`, `processing`, `received` וכו' — הן נשארות בדיוק כפי שהן.
- הרצה חד-פעמית דרך `invoke-server-function` (server fn חדש `reprocessMissingClientMessages` תחת `requireSupabaseAuth` + בדיקת `has_role('admin')`) או ישירות דרך סקריפט חד-פעמי.
- מדווח בסוף: כמה הודעות טופלו, כמה נכתבו בהצלחה, כמה נשארו `missing_client` (במקרה כזה סימן שהחוק החדש עדיין לא תפס אותן — נבדוק ידנית).

### מה **לא** משתנה

- **לא מוחקים אף כינוי.** הכינוי "תהילה" → `עוד רוני כהן` נשאר.
- אין שינוי סכימה ב-DB.
- אין שינוי ב-UI.
- הודעות שכבר בסטטוס `done` לא נוגעים בהן.

## פרטים טכניים

**קובץ ראשי:** `src/lib/processing.server.ts`

- `extractAnchoredNames(rawText)` — עובד על הטקסט המקורי, מזהה מילים מפעילות ומחזיר את הטוקן/ים הבאים (עם `normalize` מובנה).
- `resolveClientId` מקבל שלב 0 חדש + סינון `afterHizmin`.
- `callLovableAI(rawText, knownClients)` — חתימה חדשה.
- `processIncomingMessage` טוען פעם אחת את הלקוחות/כינויים ומעביר הלאה.

**קובץ שני:** `src/lib/admin.functions.ts` (או קובץ חדש `src/lib/reprocess.functions.ts`)

- `reprocessMissingClientMessages` — `createServerFn` תחת `requireSupabaseAuth` + `has_role('admin')`, שסורק את הודעות המשתמש בסטטוס `missing_client` ומריץ מחדש.
- מחזיר `{ attempted, succeeded, stillMissing, failed }`.
- אקרא לו פעם אחת אחרי הפריסה עם `stack_modern--invoke-server-function` ואדווח תוצאות.

## סיכון

התוספת גורפת (`עבור`/`הזמין` הן מילים נפוצות ולכן משתלמות). כדי לא לפגוע בהודעות ישנות שהצליחו: החוק החדש רץ **ראשון** אך רק **מוסיף** התאמה; אם `afterAvur` לא נותן התאמה מדויקת, ההתנהגות הקיימת נשמרת. הסינון של `afterHizmin` פועל רק על טוקנים שממש הופיעו אחרי מילה מזמינה. וההרצה מחדש מוגבלת ל-`missing_client` בלבד, כך שאין סיכון לדריסת נתונים תקינים.
