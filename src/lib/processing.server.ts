/**
 * Core message-processing logic. Server-only.
 * Parses Hebrew WhatsApp text into a structured delivery and writes it.
 *
 * Accepts any Supabase client (admin from webhook, or per-user from server fn).
 * The client is responsible for RLS scoping (or bypassing) before calling.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

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
  "price": number | null,               // Numeric price in NIS if explicitly mentioned (e.g. "120 שח", "₪80"), else null.
  "delivery_date": string | null,       // ISO date YYYY-MM-DD if mentioned ("מחר", "ביום ראשון", "15/3"). null = today.
  "contact_ordered_by": string | null,  // Name of the person who placed the order, if mentioned.
  "notes": string | null                // Any extra remarks (urgency, contact phone, etc).
}

Rules:
- Output JSON only. No markdown, no commentary.
- description is REQUIRED and must be non-empty Hebrew text.
- Dates: "היום"=today, "מחר"=tomorrow. Use the provided "today" date as reference.
- If you cannot extract a description, set description to the raw text.`;

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
): Promise<{ clientId: string; matched: boolean }> {
  if (clientName) {
    const norm = normalize(clientName);

    // 1. alias match
    const { data: aliases } = await supabase
      .from("client_aliases")
      .select("client_id, alias")
      .eq("user_id", userId);
    const aliasHit = (aliases ?? []).find((a) => normalize(a.alias) === norm);
    if (aliasHit) return { clientId: aliasHit.client_id, matched: true };

    // 2. client name match
    const { data: clients } = await supabase
      .from("clients")
      .select("id, client_name, is_miscellaneous")
      .eq("user_id", userId)
      .eq("is_archived", false);
    const nameHit = (clients ?? []).find((c) => normalize(c.client_name) === norm);
    if (nameHit) return { clientId: nameHit.id, matched: true };
  }

  // 3. fallback to "מזדמנים"
  const { data: misc } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .eq("is_miscellaneous", true)
    .maybeSingle();
  if (!misc) throw new Error('לא נמצא לקוח "מזדמנים" עבור המשתמש');
  return { clientId: misc.id, matched: false };
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
    const { clientId, matched } = await resolveClientId(supabase, msg.user_id, parsed.client_name);

    const deliveryDate = parsed.delivery_date ?? new Date().toISOString().slice(0, 10);

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
