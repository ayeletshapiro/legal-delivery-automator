# הוספת תמיכה בהודעות ווצאפ קוליות

כיום כשמגיעה הודעה קולית מטוויליו, היא נשמרת ב-`incoming_messages` עם `message_type=audio` ו-`media_received=true`, אבל לא נעשה איתה כלום — אין תמלול ואין עיבוד. נתקן את זה.

## מה ייבנה

### 1) הורדה ותמלול בתוך ה-Webhook של טוויליו
בקובץ `src/routes/api/public/twilio-webhook.ts`, אחרי שההודעה נכנסת למסד:

- אם `messageType === "audio"` ו-`MediaUrl0` קיים:
  1. מורידים את הקובץ מ-Twilio עם Basic Auth: `AccountSid:AuthToken` (שניהם מגיעים מתוך ה-Webhook עצמו — `params["AccountSid"]` + הסוד `TWILIO_AUTH_TOKEN`). אין צורך בסוד חדש.
  2. שולחים ל-Lovable AI:
     - `POST https://ai.gateway.lovable.dev/v1/audio/transcriptions`
     - `model: openai/gpt-4o-mini-transcribe`
     - `language: he` (עברית)
     - `stream: "false"` (כי אנחנו בצד שרת ולא צריכים סטרימינג ל-UI)
     - שם הקובץ נגזר מ-`MediaContentType0` (`audio/ogg` → `recording.ogg`, `audio/mpeg` → `mp3`, וכו') כדי שהמודל יזהה את הפורמט נכון.
  3. מעדכנים את `incoming_messages.transcribed_text` עם הטקסט שחזר.
  4. אם המשתמש מזוהה (`profile?.id`) — קוראים ל-`processIncomingMessage` בדיוק כמו בטקסט. כל לוגיקת ה-AI/לקוח/גיליון כבר עובדת על `transcribed_text || raw_text`.

### 2) טיפול בכשלים
- כשל בהורדה / כשל בתמלול:
  - `status = "transcription_failed"`, `error_detail` עם הסיבה (קוד HTTP + תקציר).
  - רישום ב-`processing_errors` עם `error_type = "transcription_failed"` כך שייראה במסך השגיאות עם ההודעה המקורית (השולח/תאריך), כפי שכבר מימשנו.
  - לא קוראים ל-`processIncomingMessage`.

### 3) כפתור "עבד" ידני להודעות קוליות
ב-`src/routes/_authenticated/messages.tsx` הכפתור "עבד / עבד מחדש" כרגע מופיע רק ל-`message_type === "text"`. נרחיב אותו גם ל-`audio` כאשר `transcribed_text` כבר קיים (אחרי תמלול מוצלח). הודעות עם `transcription_failed` ללא טקסט — לא יהיה כפתור עיבוד; אם נרצה תמלול-חוזר נטפל בזה בהמשך.

### 4) ללא שינוי סכמה
לא נוספות עמודות. `transcribed_text` כבר קיים ב-`incoming_messages`. אין צורך במיגרציה.

## נקודות טכניות

- `TWILIO_AUTH_TOKEN` כבר קיים בסודות. `AccountSid` מגיע בכל webhook של Twilio בתוך גוף הבקשה — אין סוד חדש.
- מודל התמלול: `openai/gpt-4o-mini-transcribe` (ברירת המחדל המומלצת של Lovable AI).
- שפה: `he` (אם נרצה לאפשר בעתיד גם ערבית/אנגלית — נחזור לאיתור אוטומטי).
- WhatsApp שולח קול כ-`audio/ogg; codecs=opus` — נדאג שסיומת הקובץ תהיה `.ogg` כדי שלא נקבל "Audio file might be corrupted".

## קבצים שישתנו

- `src/routes/api/public/twilio-webhook.ts` — הורדת מדיה, קריאה ל-Lovable AI, עדכון `transcribed_text`, קריאה ל-`processIncomingMessage`, טיפול בשגיאות.
- `src/routes/_authenticated/messages.tsx` — הצגת כפתור "עבד" גם להודעות `audio` שיש להן `transcribed_text`.

## איך לבדוק

1. לשלוח לטוויליו הודעה קולית בעברית, למשל: "הלפר, חמישים שקל כולל מעמ, מסמכים לבית משפט מחר".
2. במסך **הודעות** רואים את ההודעה עם `סוג=קולי` ועמודת "תוכן" מציגה את התמלול.
3. במסך **משלוחים** נוצרת שורה חדשה עם המחיר הנכון נטו (42.37 לדוגמה) והערה "מחיר בהודעה: 50₪ כולל מע\"מ".
4. אם נכשל התמלול — מופיע במסך **שגיאות** עם ההודעה המקורית והשולח.
