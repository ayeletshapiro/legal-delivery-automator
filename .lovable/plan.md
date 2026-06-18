## עדכון: מחיר אינו חובה

נכתוב לאקסל גם הודעות בלי מחיר. שדות המחיר/סה"כ יישארו ריקים בגיליון, והמשתמשת תוכל למלא ידנית. אין שגיאה ואין סטטוס "חסר מחיר".

## מה אעשה

### 1) כתיבה לגיליון גם בלי מחיר
- `writeDeliveryToClientSheet` (ב`processing.server.ts`) יסיר את ה-early return כשאין מחיר ויכתוב את השורה תמיד.
- `appendDeliveryToSheet` (ב`sheets.server.ts`) — כש-`price == null`, יישלחו תאים ריקים `""` לעמודות מחיר / סה"כ ללא מע"מ / סה"כ אחרי מע"מ (במקום `0`), כדי שהמשתמשת תוכל למלא ידנית והנוסחאות ב-AVG/SUM שלה לא יזדהמו באפסים.
- ב-`processIncomingMessage`: הקריאה ל-`writeDeliveryToClientSheet` תתבצע תמיד כש-`matched`, בלי תנאי `price != null` (גם בנתיב היצירה החדש וגם בנתיב ה-existing delivery).
- `listDeliveries` (התיקון האוטומטי של "ללא גיליון") יתקן גם שורות בלי מחיר — מסירים את `row.price != null`.
- אין שגיאה ב`processing_errors` על חוסר מחיר, ואין סטטוס "חסר מחיר" בהודעות. המחוון `price_missing` ב-deliveries יישאר רק לסימון ויזואלי בטבלת המשלוחים (Badge "חסר" שכבר קיים).

### 2) שם הגיליון
- ב`createSheetForClient`: כותרת הגיליון תהיה רק `clientName`, בלי "שליחויות - ".

### 3) טבלת שגיאות — איזו הודעה
- `listErrors` יבצע join ל-`incoming_messages` ויחזיר `raw_text` / `transcribed_text` / `sender_phone` / `received_at`.
- מסך השגיאות יקבל עמודה חדשה "הודעה" שמציגה את טקסט ההודעה (truncate + tooltip לטקסט מלא) ואת מספר השולח.

### 4) פרומפט AI — מע"מ
ב-`SYSTEM_PROMPT` ב`processing.server.ts`:
- "כולל מע"מ" / "אחרי מע"מ" → להחזיר `price = amount / 1.18` (מעוגל ל-2 ספרות).
- "לפני מע"מ" / "בלי מע"מ" / "+ מע"מ" / "פלוס מע"מ" → להחזיר את הסכום כפי שהוא.
- בלי התייחסות → להניח לפני מע"מ (התנהגות נוכחית).
- כשהיה חישוב מע"מ — להוסיף ל-`notes` הערה קצרה (למשל "מחיר בהודעה: 40₪ כולל מע"מ") לתיעוד.

## קבצים שיתעדכנו
- `src/lib/processing.server.ts` — פרומפט מע"מ, הסרת תנאי המחיר.
- `src/lib/sheets.server.ts` — שם הגיליון, תאים ריקים כשאין מחיר.
- `src/lib/deliveries.functions.ts` — תיקון אוטומטי גם בלי מחיר.
- `src/lib/errors.functions.ts` — join להודעה.
- `src/routes/_authenticated/errors.tsx` — עמודת "הודעה".
