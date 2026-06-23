## Goal

When the courier sends a WhatsApp message that also includes a media attachment, the resulting line in the client's Google Sheet should show — in the notes column — either:
- **תמונה מצורפת** for an image, or
- **מסמך מצורף** for any other attached file (PDF, Word, etc.).

Audio messages are excluded (the voice note *is* the message, not an attachment to it).

## Where the change goes

The webhook already detects the message type (`text` / `audio` / `image` / `document`) and stores it on `incoming_messages.message_type`, plus `media_received = true` when `NumMedia > 0`. The notes that end up in Sheets come from `processIncomingMessage` in `src/lib/processing.server.ts`, which calls the AI parser and uses `parsed.notes` when inserting a new `deliveries` row.

We only need a tiny addition in that one function — no schema changes, no webhook changes, no UI changes.

### Edit: `src/lib/processing.server.ts` → `processIncomingMessage`

1. After loading the `msg` row and before parsing/inserting, compute an attachment note:
   - `image` → `"תמונה מצורפת"`
   - `document` → `"מסמך מצורף"`
   - anything else (`text`, `audio`) → no attachment note
2. After the AI returns `parsed`, merge the attachment note into `parsed.notes`:
   - if `parsed.notes` is empty → use the attachment note as-is
   - otherwise → join with `" · "` (so an existing VAT note is preserved)
3. Use this merged value in **both** insert branches (the "matched" insert at ~L949 and the "awaiting_clarification" insert at ~L988), and also in the immediate `writeDeliveryToClientSheet` call at ~L967.

Because the clarification flow re-reads the delivery row's `notes` field when it eventually writes to Sheets, attachments sent with the original message will automatically carry through to the sheet after the user resolves the clarification — no separate change needed there.

## Out of scope

- No changes to the webhook signature/validation logic.
- No new DB columns: `incoming_messages.message_type` and `media_received` already capture what we need.
- No changes to manual edit UI: if the user later edits the notes from the deliveries screen, their edit wins (as today).
- Audio-only messages and pure text messages behave exactly as before.
