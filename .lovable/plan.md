# RTL וגיליון אוטומטי לכל לקוח

## 1. RTL בגיליון Google Sheets

הבעיה: גיליון Google חדש הוא LTR כברירת מחדל, אז עמודה A מופיעה משמאל — לא מתאים לעברית.

הפתרון: קריאה ל-`batchUpdate` של Sheets כדי להגדיר את הגיליון כ-RTL:

```
POST /spreadsheets/{id}:batchUpdate
{ "requests": [{ "updateSheetProperties": {
    "properties": { "sheetId": 0, "rightToLeft": true },
    "fields": "rightToLeft"
}}]}
```

כך עמודה A (תאריך) תוצג בצד ימין ו-G (סה"כ אחרי מע"מ) בצד שמאל. נעשה זאת פעם אחת בלבד — כשיוצרים כותרות חדשות ב-`ensureHeaders` (כך גם גיליונות ישנים שלא היו RTL ייכנסו לתבנית הנכונה כשנכתב לראשונה).

## 2. עמוד השליחויות (deliveries.tsx) — סדר עמודות

האפליקציה כבר RTL כללית. אקרא את `src/routes/_authenticated/deliveries.tsx` ואסדר את עמודות הטבלה לפי הסדר שביקשת (מימין לשמאל):
תאריך → תיאור → הזמין → הערות → מחיר → סה"כ ללא מע"מ → סה"כ אחרי מע"מ → סטטוס כתיבה.
שתי עמודות הסה"כ יחושבו בצד הלקוח (price ו-`price × 1.18`) כדי להציג את אותם ערכים כמו בגיליון.

## 3. יצירה אוטומטית של גיליון ללקוח חדש

זרימה ב-`processing.server.ts` אחרי שזיהינו לקוח (matched) ויש מחיר:

```
load client (google_sheet_id, client_name)
if !google_sheet_id:
  sheetId = await createSheetForClient(client_name)
  update clients set google_sheet_id = sheetId where id = clientId
appendDeliveryToSheet(sheetId, ...)
```

### `createSheetForClient(clientName)` חדשה ב-`sheets.server.ts`

```
POST /spreadsheets
{
  "properties": { "title": `שליחויות - ${clientName}`, "locale": "he_IL" },
  "sheets": [{ "properties": { "title": "שליחויות", "rightToLeft": true } }]
}
```

מחזיר `spreadsheetId`. מיד אחר כך `ensureHeaders` יכתוב את שורת הכותרות.

### הערות חשובות
- **בעלות**: הגיליון ייווצר תחת חשבון Google המחובר (כרגע שלך). שיתוף אוטומטי עם מייל הלקוח — דחוי לעתיד לפי בקשתך.
- **מניעת כפילויות**: נשמור את ה-ID מיד אחרי יצירה כך שלא ייווצרו גיליונות כפולים.
- **כשל ביצירה**: `write_status = "שגיאה"` + רישום ל-`processing_errors`. ה-ID לא יישמר, כך שניסיון חוזר יצור גיליון חדש.

## 4. עדכון מסך הלקוחות

שדה ה-`google_sheet_id` יישאר עריך (אפשר להחליף ידנית). נוסיף placeholder/רמז קטן: "ייווצר אוטומטית בהודעה הראשונה" כשהשדה ריק.

## קבצים שייגעו

- `src/lib/sheets.server.ts` — `createSheetForClient` חדשה, קריאת `batchUpdate` ל-rightToLeft ב-`ensureHeaders`.
- `src/lib/processing.server.ts` — יצירה אוטומטית + שמירת ה-ID חזרה בטבלת clients.
- `src/routes/_authenticated/deliveries.tsx` — סדר עמודות + שתי עמודות סה"כ.
- `src/routes/_authenticated/clients.tsx` — placeholder לשדה ה-ID.

## שדרוג עתידי (לזכור)
שיתוף אוטומטי של הגיליון עם מייל הלקוח כ-editor אחרי יצירתו — דורש הוספת `client_email` לטבלת clients. לא נעשה עכשיו.
