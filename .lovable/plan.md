## Goal

Delete the WhatsApp clarification flow entirely. On a no-client-match, the system marks the message as `missing_client`, logs an error, and sends one Hebrew "please resend with client name" reply. No pending state, no auto-assignment to "מזדמנים", no UI for pending clarifications.

## Code changes

### `src/lib/processing.server.ts` — rewrite the no-match branch

Delete these symbols and every reference to them:
- `tryHandleClarificationReply` (export) + its `ClarificationOutcome` type
- `expireStaleClarifications`
- `buildClarificationMessage`
- `suggestSimilarClients`
- All `from("pending_clarifications")` reads/writes/inserts/updates
- The `"awaiting_clarification"` branch in `processIncomingMessage` (~L1043–L1118) and the helper that opens a clarification with service-role retry (~L796–L830)

Change `resolveClientId` (~L622):
- Remove the final "fallback to מזדמנים" block (~L663–L666).
- On no match return `{ clientId: null, matched: false }`. Update its return type.

In `processIncomingMessage` after `resolveClientId`, when `matched === false`:
1. Do not insert a delivery, do not write to any sheet.
2. `update incoming_messages set status='missing_client', error_detail='לא זוהה שם לקוח בהודעה', processed_at=now()`.
3. Insert `processing_errors` row: `error_type='missing_client'`, Hebrew description.
4. `sendWhatsAppMessage(sender, "❗ ההודעה לא נקלטה — לא זוהה שם לקוח. אנא שלח את ההודעה שוב כולל שם הלקוח .", { replyType: "missing_client", ... })`.
5. Return `{ ok: true, status: "missing_client" }`.

Drop `"awaiting_clarification"` and `"skipped_reply"` from the result-status union.

### `src/routes/api/public/twilio-webhook.ts`

- Remove both `tryHandleClarificationReply` imports and both `outcome.kind` switch blocks (text branch ~L120–L150, audio branch ~L218–L248).
- Replace each with a direct `await processIncomingMessage(supabaseAdmin, inserted.id, businessPhone)` for known users.
- Keep duplicate-`whatsapp_message_id` 200 short-circuit and signature check exactly as today. (No `maxDuration` export exists currently; not adding one in this change.)

### `src/lib/clarifications.functions.ts` — delete the file

Nothing else should import it after the UI cleanup below.

### UI cleanup (required for the build to stay green)

The current UI imports the functions being deleted; these are unavoidable build-fix edits, not feature changes:

- **Delete** `src/routes/_authenticated/clarifications.tsx`.
- **`src/components/app-sidebar.tsx`** — remove the `{ title: "בירורים", url: "/clarifications", ... }` nav entry.
- **`src/routes/_authenticated/dashboard.tsx`** — remove the amber clarifications banner block (L78–L88) and the now-unused `HelpCircle`/`ChevronLeft` imports if they become unused.
- **`src/lib/dashboard.functions.ts`** — remove the `pending_clarifications` count query and the `openClarifications` field from the returned object.

After deleting the route file, `src/routeTree.gen.ts` will regenerate automatically on next dev/build.

### Comment-only touch-ups

- `src/lib/processing.functions.ts` L11 — update the comment to drop `pending_clarifications` from the list of tables it mentions.
- Add a short note at the top of `supabase/migrations/` (e.g. a new `README.md` line, or a comment in the next migration) marking `public.pending_clarifications` as **deprecated, unused by app code, intentionally not dropped**.

## Database

No migration. `pending_clarifications` stays in place, untouched, with zero application reads or writes. No new tables, no new columns.

## Keep untouched

- `resolveClientId` matching (name + alias + token scan) — only its final misc-fallback is removed.
- Happy path: matched client → insert delivery → `writeDeliveryToClientSheet` → status `done` → optional confirmation message.
- Attachment-note logic (`mergeNotes` + `"תמונה מצורפת"` / `"מסמך מצורף"`).
- Audio transcription path in the webhook.
- Twilio signature validation and the `63016` outside-24h-window logging in `twilio.server.ts`.
- `app_config`, `client_aliases`, `clients`, `deliveries`, `incoming_messages`, `outbound_messages`, `processing_errors` tables and their RLS.

## Verification after build

- `rg "pending_clarifications|tryHandleClarification|expireStaleClarifications|buildClarificationMessage|suggestSimilarClients|ClarificationOutcome|awaiting_clarification" src/` returns no hits.
- TypeScript build passes.
- Sending a message with an unknown client name results in: `incoming_messages.status = missing_client`, one row in `processing_errors`, one outbound WhatsApp logged in `outbound_messages` with the Hebrew resend prompt, and no delivery row created.
