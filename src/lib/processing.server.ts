/**
 * Core message-processing logic. Server-only.
 * Parses Hebrew WhatsApp text into a structured delivery and writes it.
 *
 * Accepts any Supabase client (admin from webhook, or per-user from server fn).
 * The client is responsible for RLS scoping (or bypassing) before calling.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { appendDeliveryToSheet, createSheetForClient } from "./sheets.server";

type DB = SupabaseClient<Database>;

interface ParsedDelivery {
  client_name: string | null;
  description: string;
  price: number | null;
  delivery_date: string | null; // YYYY-MM-DD
  contact_ordered_by: string | null;
  notes: string | null;
}

const SYSTEM_PROMPT = `You extract a single legal-document delivery task from a Hebrew WhatsApp message sent by an attorney to a courier service.

Return STRICT JSON only, matching this schema:
{
  "client_name": string | null,         // The law firm / lawyer / client this delivery is FOR (often the first word/line). null if unclear.
  "description": string,                // Short Hebrew description of what to deliver and to where (court, address, person).
  "price": number | null,               // Numeric NET price in NIS (BEFORE VAT) if mentioned. See VAT rules below. null if no price mentioned.
  "delivery_date": string | null,       // ISO date YYYY-MM-DD if mentioned ("מחר", "ביום ראשון", "15/3"). null = today.
  "contact_ordered_by": string | null,  // Name of the person who placed the order, if mentioned.
  "notes": string | null                // Any extra remarks (urgency, contact phone, etc). Append VAT note when applicable (see below).
}

Rules:
- Output JSON only. No markdown, no commentary.
- description is REQUIRED and must be non-empty Hebrew text.
- client_name: usually the FIRST word or line of the message (a surname like "הלפר", a firm like "כהן ושות'", or "עו\"ד X" / "משרד X"). Extract it even if it's a single word with no title. Only return null if the message clearly has no name at the start.
- Dates: "היום"=today, "מחר"=tomorrow. Use the provided "today" date as reference.
- If you cannot extract a description, set description to the raw text.

VAT (מע"מ) handling — VAT rate is 18%:
- The "price" field MUST ALWAYS be the NET price (before VAT). The spreadsheet computes VAT automatically.
- If the message mentions a price WITH VAT (e.g. "40 שח כולל מעמ", "כולל מע\"מ", "אחרי מע\"מ", "ברוטו"): divide the amount by 1.18 and round to 2 decimals. Example: "40 כולל מעמ" → price = 33.90.
- If the message mentions a price BEFORE VAT (e.g. "40 לפני מעמ", "בלי מעמ", "+ מעמ", "פלוס מעמ", "נטו"): use the amount as-is.
- If VAT is not mentioned: assume the amount is already NET (before VAT) and use it as-is.
- When you performed a VAT conversion (i.e. user said "כולל מע\"מ"), append a short Hebrew note to "notes" like: "מחיר בהודעה: 40₪ כולל מע\"מ" so the original is preserved.`;


async function callLovableAI(rawText: string): Promise<ParsedDelivery> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = `today=${today}\n\nMESSAGE:\n${rawText}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`AI gateway ${resp.status}: ${body.slice(0, 200)}`);
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI returned empty content");
  const parsed = JSON.parse(content);

  return {
    client_name: parsed.client_name ?? null,
    description: String(parsed.description ?? "").trim() || rawText.trim(),
    price: typeof parsed.price === "number" ? parsed.price : null,
    delivery_date: parsed.delivery_date ?? null,
    contact_ordered_by: parsed.contact_ordered_by ?? null,
    notes: parsed.notes ?? null,
  };
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/["'״׳]/g, "").replace(/\s+/g, " ");
}

async function resolveClientId(
  supabase: DB,
  userId: string,
  clientName: string | null,
  rawText: string,
): Promise<{ clientId: string; matched: boolean }> {
  // Load all aliases + clients up-front (used by both AI-name match and raw-text scan)
  const { data: aliases } = await supabase
    .from("client_aliases")
    .select("client_id, alias")
    .eq("user_id", userId);
  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name, is_miscellaneous, is_archived")
    .eq("user_id", userId)
    .eq("is_archived", false);

  const activeClients = clients ?? [];
  const allAliases = aliases ?? [];

  if (clientName) {
    const norm = normalize(clientName);
    const aliasHit = allAliases.find((a) => normalize(a.alias) === norm);
    if (aliasHit) return { clientId: aliasHit.client_id, matched: true };
    const nameHit = activeClients.find((c) => normalize(c.client_name) === norm);
    if (nameHit) return { clientId: nameHit.id, matched: true };
  }

  // Fallback: scan the raw message text for any alias or client name (whole-word match)
  const normText = ` ${normalize(rawText)} `;
  const candidates = new Set<string>();
  for (const a of allAliases) {
    const n = normalize(a.alias);
    if (n && normText.includes(` ${n} `)) candidates.add(a.client_id);
  }
  for (const c of activeClients) {
    if (c.is_miscellaneous) continue;
    const n = normalize(c.client_name);
    if (n && normText.includes(` ${n} `)) candidates.add(c.id);
  }
  if (candidates.size === 1) {
    return { clientId: [...candidates][0], matched: true };
  }

  // Fallback to "מזדמנים"
  const misc = activeClients.find((c) => c.is_miscellaneous);
  if (!misc) throw new Error('לא נמצא לקוח "מזדמנים" עבור המשתמש');
  return { clientId: misc.id, matched: false };
}

interface DeliverySheetWriteInput {
  deliveryId: string;
  messageId: string | null;
  userId: string;
  clientId: string;
  delivery_date: string;
  description: string;
  contact_ordered_by: string | null;
  notes: string | null;
  price: number | null;
}

export async function writeDeliveryToClientSheet(
  supabase: DB,
  delivery: DeliverySheetWriteInput,
): Promise<{ writeStatus: string; writeError: string | null }> {
  let writeStatus: string = "pending";
  let writeError: string | null = null;
  let writtenSheetId: string | null = null;

  try {
    const { data: clientRow, error: clientErr } = await supabase
      .from("clients")
      .select("google_sheet_id, client_name")
      .eq("id", delivery.clientId)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!clientRow) throw new Error("הלקוח המשויך למשלוח לא נמצא");

    let sheetId = clientRow.google_sheet_id?.trim() || null;
    if (!sheetId && clientRow.client_name) {
      sheetId = await createSheetForClient(clientRow.client_name);
      const { error: updateClientErr } = await supabase
        .from("clients")
        .update({ google_sheet_id: sheetId })
        .eq("id", delivery.clientId);
      if (updateClientErr) throw new Error(`שמירת מזהה הגיליון נכשלה: ${updateClientErr.message}`);
    }

    if (sheetId) {
      // Dedup: check if this delivery was already written to this sheet
      const { data: delRow, error: delRowErr } = await supabase
        .from("deliveries")
        .select("written_sheet_ids")
        .eq("id", delivery.deliveryId)
        .maybeSingle();
      if (delRowErr) throw delRowErr;
      const already = (delRow?.written_sheet_ids ?? []) as string[];

      if (already.includes(sheetId)) {
        // Already written to this exact sheet — don't append again
        writeStatus = "נכתב";
      } else {
        const result = await appendDeliveryToSheet(sheetId, {
          delivery_date: delivery.delivery_date,
          description: delivery.description,
          contact_ordered_by: delivery.contact_ordered_by,
          notes: delivery.notes,
          price: delivery.price,
        });
        if (result.ok) {
          writeStatus = "נכתב";
          writtenSheetId = sheetId;
        } else {
          writeStatus = "שגיאה";
          writeError = result.error ?? "שגיאה לא ידועה";
        }
      }
    } else {
      writeStatus = "ללא גיליון";
    }
  } catch (createOrWriteErr: unknown) {
    writeStatus = "שגיאה";
    writeError = createOrWriteErr instanceof Error ? createOrWriteErr.message : "שגיאה לא ידועה ביצירת/כתיבת גיליון";
  }

  const updatePayload: Record<string, unknown> = {
    write_status: writeStatus,
    write_error: writeError,
    written_at: writeStatus === "נכתב" ? new Date().toISOString() : null,
  };
  if (writtenSheetId) {
    // Append to the array atomically by reading current value first
    const { data: cur } = await supabase
      .from("deliveries")
      .select("written_sheet_ids")
      .eq("id", delivery.deliveryId)
      .maybeSingle();
    const existing = ((cur?.written_sheet_ids ?? []) as string[]).filter((s) => s !== writtenSheetId);
    updatePayload.written_sheet_ids = [...existing, writtenSheetId];
  }
  const { error: updateDeliveryErr } = await supabase.from("deliveries").update(updatePayload).eq("id", delivery.deliveryId);
  if (updateDeliveryErr) throw updateDeliveryErr;


  if (writeStatus === "שגיאה" && writeError && delivery.messageId) {
    await supabase.from("processing_errors").insert({
      message_id: delivery.messageId,
      user_id: delivery.userId,
      error_type: "sheet_write_failed",
      error_description: `כשל בכתיבה לגיליון: ${writeError}`,
    });
  }

  return { writeStatus, writeError };
}


export interface ProcessResult {
  ok: boolean;
  status: "done" | "missing_client" | "missing_details" | "failed";
  deliveryId?: string;
  errorMessage?: string;
}

export async function processIncomingMessage(
  supabase: DB,
  messageId: string,
): Promise<ProcessResult> {
  // Load message
  const { data: msg, error: msgErr } = await supabase
    .from("incoming_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (msgErr) throw msgErr;
  if (!msg) throw new Error("הודעה לא נמצאה");

  if (!msg.user_id) {
    const reason = "המשתמש לא מזוהה (מספר ה-WhatsApp של השולח לא מוגדר בפרופיל)";
    await supabase.from("incoming_messages").update({
      status: "failed", error_detail: reason, processed_at: new Date().toISOString(),
    }).eq("id", messageId);
    return { ok: false, status: "failed", errorMessage: reason };
  }

  const text = (msg.transcribed_text || msg.raw_text || "").trim();
  if (!text) {
    const reason = "אין טקסט לעיבוד";
    await supabase.from("incoming_messages").update({
      status: "missing_details", error_detail: reason, processed_at: new Date().toISOString(),
    }).eq("id", messageId);
    await supabase.from("processing_errors").insert({
      message_id: messageId, user_id: msg.user_id,
      error_type: "missing_details", error_description: reason,
    });
    return { ok: false, status: "missing_details", errorMessage: reason };
  }

  await supabase.from("incoming_messages").update({ status: "processing" }).eq("id", messageId);

  try {
    const parsed = await callLovableAI(text);
    const { clientId, matched } = await resolveClientId(supabase, msg.user_id, parsed.client_name, text);

    const deliveryDate = parsed.delivery_date ?? new Date().toISOString().slice(0, 10);

    const { data: existingDelivery, error: existingErr } = await supabase
      .from("deliveries")
      .select("id, message_id, user_id, client_id, delivery_date, description, contact_ordered_by, notes, price, write_status")
      .eq("message_id", messageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existingDelivery) {
      // On reprocess: if we now resolved a different/real client, re-assign the delivery
      // to that client so it isn't stuck on the previously-set "מזדמנים".
      const clientChanged = existingDelivery.client_id !== clientId;
      if (clientChanged) {
        const { error: reassignErr } = await supabase
          .from("deliveries")
          .update({
            client_id: clientId,
            write_status: "pending",
            write_error: null,
            written_at: null,
          })
          .eq("id", existingDelivery.id);
        if (reassignErr) throw reassignErr;
        existingDelivery.client_id = clientId;
        existingDelivery.write_status = "pending";
      }

      if (matched && existingDelivery.write_status !== "נכתב") {
        await writeDeliveryToClientSheet(supabase, {
          deliveryId: existingDelivery.id,
          messageId: existingDelivery.message_id,
          userId: existingDelivery.user_id,
          clientId: existingDelivery.client_id,
          delivery_date: existingDelivery.delivery_date,
          description: existingDelivery.description,
          contact_ordered_by: existingDelivery.contact_ordered_by,
          notes: existingDelivery.notes,
          price: existingDelivery.price,
        });
      }
      await supabase.from("incoming_messages").update({
        status: matched ? "done" : "missing_client",
        error_detail: matched ? null : `שובץ ל"מזדמנים" — לא זוהה לקוח מתוך: ${parsed.client_name ?? "(ריק)"}`,
        processed_at: new Date().toISOString(),
      }).eq("id", messageId);
      return { ok: true, status: matched ? "done" : "missing_client", deliveryId: existingDelivery.id };
    }

    const { data: delivery, error: delErr } = await supabase.from("deliveries").insert({
      message_id: messageId,
      client_id: clientId,
      user_id: msg.user_id,
      delivery_date: deliveryDate,
      description: parsed.description,
      notes: parsed.notes,
      price: parsed.price,
      price_missing: parsed.price == null,
      contact_ordered_by: parsed.contact_ordered_by,
      write_status: "pending",
    }).select("id").single();
    if (delErr) throw delErr;

    if (matched) {
      await writeDeliveryToClientSheet(supabase, {
        deliveryId: delivery.id,
        messageId,
        userId: msg.user_id,
        clientId,
        delivery_date: deliveryDate,
        description: parsed.description,
        contact_ordered_by: parsed.contact_ordered_by,
        notes: parsed.notes,
        price: parsed.price,
      });
    }

    const finalStatus = matched ? "done" : "missing_client";
    const errDetail = matched ? null : `שובץ ל"מזדמנים" — לא זוהה לקוח מתוך: ${parsed.client_name ?? "(ריק)"}`;
    await supabase.from("incoming_messages").update({
      status: finalStatus, error_detail: errDetail, processed_at: new Date().toISOString(),
    }).eq("id", messageId);

    if (!matched) {
      await supabase.from("processing_errors").insert({
        message_id: messageId, user_id: msg.user_id,
        error_type: "missing_client",
        error_description: errDetail!,
      });
    }
    return { ok: true, status: finalStatus, deliveryId: delivery.id };
  } catch (e: any) {
    const reason = e?.message ?? "שגיאה לא ידועה";
    await supabase.from("incoming_messages").update({
      status: "failed", error_detail: reason, processed_at: new Date().toISOString(),
    }).eq("id", messageId);
    await supabase.from("processing_errors").insert({
      message_id: messageId, user_id: msg.user_id,
      error_type: "processing_failed", error_description: reason,
    });
    return { ok: false, status: "failed", errorMessage: reason };
  }
}
