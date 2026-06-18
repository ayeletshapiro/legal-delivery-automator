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
import { sendWhatsAppMessage } from "./twilio.server";

type DB = SupabaseClient<Database>;

const CLARIFICATION_TTL_HOURS = 24;
const CANCEL_WORDS = ["בטל", "ביטול", "דלג", "התחל מחדש", "cancel"];

/** Today as YYYY-MM-DD in Asia/Jerusalem (not UTC). */
function israelToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Validate YYYY-MM-DD as a real calendar date. */
function isValidIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Read VAT rate from app_config (cached per request). Falls back to 0.18. */
let _vatRateCache: number | null = null;
async function loadVatRate(supabase: DB, userId: string): Promise<number> {
  if (_vatRateCache != null) return _vatRateCache;
  const { data } = await supabase
    .from("app_config")
    .select("vat_rate")
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order("user_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  _vatRateCache = typeof data?.vat_rate === "number" ? data.vat_rate : 0.18;
  return _vatRateCache;
}

function buildClarificationMessage(rawText: string, suggestions: string[] = []): string {
  const truncated = rawText.length > 200 ? rawText.slice(0, 200) + "…" : rawText;
  const lines = [
    "🤖 לא זיהיתי לאיזה לקוח לשייך את השליחות:",
    `"${truncated}"`,
    "",
    "מה לעשות?",
    "• אם זה לקוח קיים — כתוב את שם הלקוח המדויק",
    "• אם זה לקוח חדש — כתוב: חדש: שם הלקוח",
    "• לשייך למזדמנים — כתוב: מזדמנים",
    "• לביטול — כתוב: בטל",
  ];
  if (suggestions.length) {
    lines.push("", "אולי התכוונת לאחד מאלה:");
    for (const s of suggestions) lines.push(`• ${s}`);
  }
  return lines.join("\n");
}

function similarityScore(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.8;
  const bigrams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = bigrams(x);
  const B = bigrams(y);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

async function suggestSimilarClients(
  supabase: DB,
  userId: string,
  hint: string,
): Promise<string[]> {
  if (!hint || !hint.trim()) return [];
  const { data: clients } = await supabase
    .from("clients")
    .select("client_name, is_miscellaneous, is_archived")
    .eq("user_id", userId)
    .eq("is_archived", false);
  const candidates = (clients ?? []).filter((c) => !c.is_miscellaneous);
  return candidates
    .map((c) => ({ name: c.client_name, score: similarityScore(c.client_name, hint) }))
    .filter((s) => s.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.name);
}

function containsKnownClient(
  text: string,
  clients: Array<{ id: string; client_name: string; is_miscellaneous: boolean }>,
  aliases: Array<{ client_id: string; alias: string }>,
): string | null {
  const tokens = tokenize(text);
  const joined = ` ${tokens.join(" ")} `;
  const hasPhrase = (phrase: string) => {
    const p = tokenize(phrase).join(" ");
    return p.length > 0 && joined.includes(` ${p} `);
  };
  for (const a of aliases) {
    if (hasPhrase(a.alias)) return a.client_id;
  }
  for (const c of clients) {
    if (c.is_miscellaneous) continue;
    if (hasPhrase(c.client_name)) return c.id;
  }
  return null;
}

/**
 * Expire (auto-close) any clarifications open for more than TTL hours for this user.
 * For each expired clarification: assign its delivery to "מזדמנים" and write to that sheet.
 */
async function expireStaleClarifications(supabase: DB, userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - CLARIFICATION_TTL_HOURS * 3600 * 1000).toISOString();
  const { data: stale } = await supabase
    .from("pending_clarifications")
    .select("id, delivery_id, message_id")
    .eq("user_id", userId)
    .is("resolved_at", null)
    .lt("created_at", cutoff);
  if (!stale || stale.length === 0) return;

  const { data: misc } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .eq("is_miscellaneous", true)
    .maybeSingle();

  for (const row of stale) {
    if (misc?.id) {
      const { data: del } = await supabase
        .from("deliveries")
        .select("id, message_id, user_id, delivery_date, description, contact_ordered_by, notes, price")
        .eq("id", row.delivery_id)
        .maybeSingle();
      if (del) {
        await supabase.from("deliveries").update({
          client_id: misc.id,
          write_status: "pending",
          write_error: null,
        }).eq("id", del.id);
        await writeDeliveryToClientSheet(supabase, {
          deliveryId: del.id,
          messageId: del.message_id,
          userId: del.user_id,
          clientId: misc.id,
          delivery_date: del.delivery_date,
          description: del.description,
          contact_ordered_by: del.contact_ordered_by,
          notes: del.notes,
          price: del.price,
        });
      }
    }
    await supabase.from("pending_clarifications").update({
      resolved_at: new Date().toISOString(),
      resolution: "expired",
    }).eq("id", row.id);
    await supabase.from("processing_errors").insert({
      message_id: row.message_id,
      user_id: userId,
      error_type: "clarification_expired",
      error_description: "בירור לקוח פג תוקף (24 שעות), המשלוח שובץ אוטומטית למזדמנים",
    });
  }
}

export type ClarificationOutcome =
  | { kind: "not_a_clarification" }
  | { kind: "resolved"; deliveryId: string }
  | { kind: "reprompted" }
  | { kind: "cancelled" };

/**
 * Handle an inbound WhatsApp text as a reply to the user's most recent open clarification.
 * Returns a discriminated outcome so callers can update incoming_messages.status correctly.
 */
export async function tryHandleClarificationReply(
  supabase: DB,
  userId: string,
  userPhone: string,
  replyText: string,
  businessPhone?: string | null,
  incomingMessageId?: string | null,
): Promise<ClarificationOutcome> {
  await expireStaleClarifications(supabase, userId);

  const { data: open } = await supabase
    .from("pending_clarifications")
    .select("id, delivery_id, message_id, raw_text, created_at")
    .eq("user_id", userId)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!open) return { kind: "not_a_clarification" };

  const text = replyText.trim();
  if (!text) return { kind: "not_a_clarification" };

  const lcRaw = text.toLowerCase().replace(/["'״׳]/g, "").trim();

  // Cancel command
  if (CANCEL_WORDS.some((w) => lcRaw === w || lcRaw === w.toLowerCase())) {
    await supabase.from("pending_clarifications").update({
      resolved_at: new Date().toISOString(),
      resolution: "cancelled",
    }).eq("id", open.id);
    // Remove the placeholder delivery so it doesn't leak into reports
    await supabase.from("deliveries").delete().eq("id", open.delivery_id);
    await supabase.from("incoming_messages").update({
      status: "cancelled",
      error_detail: "המשתמש ביטל את הבירור דרך WhatsApp",
      processed_at: new Date().toISOString(),
    }).eq("id", open.message_id);
    await sendWhatsAppMessage(userPhone, "✅ הבירור בוטל. אפשר לשלוח הודעה חדשה.", {
      fromPhone: businessPhone,
      supabase,
      userId,
      incomingMessageId: incomingMessageId ?? open.message_id,
      replyType: "cancel_ack",
    });
    return { kind: "cancelled" };
  }

  // NOTE: Do NOT smart-skip to processIncomingMessage here. If the reply contains
  // a known client name/alias, we resolve THIS clarification using that client
  // and write the ORIGINAL delivery details to Sheets (handled below in mode=name).


  let mode: "misc" | "create" | "name";
  let nameArg: string | null = null;

  if (/^(מזדמנים|misc)\b/i.test(lcRaw)) {
    mode = "misc";
  } else if (/^חדש\s*[:：]/.test(text) || /^new\s*:/i.test(text)) {
    mode = "create";
    nameArg = text.replace(/^(חדש|new)\s*[:：]\s*/i, "").trim();
    if (!nameArg) {
      await sendWhatsAppMessage(userPhone, "❗ ציין/י שם אחרי \"חדש:\" — לדוגמה: חדש: כהן ושות׳", {
        fromPhone: businessPhone, supabase, userId,
        incomingMessageId: incomingMessageId ?? open.message_id,
        replyType: "clarification_reprompt",
      });
      return { kind: "reprompted" };
    }
  } else {
    mode = "name";
    nameArg = text;
  }

  const { data: del } = await supabase
    .from("deliveries")
    .select("id, message_id, user_id, delivery_date, description, contact_ordered_by, notes, price")
    .eq("id", open.delivery_id)
    .maybeSingle();
  if (!del) {
    await supabase.from("pending_clarifications").update({
      resolved_at: new Date().toISOString(), resolution: "expired",
    }).eq("id", open.id);
    return { kind: "not_a_clarification" };
  }

  let targetClientId: string | null = null;
  let resolution: "matched" | "misc" | "created" = "misc";
  let confirmName = "";

  if (mode === "misc") {
    let { data: misc } = await supabase
      .from("clients").select("id, client_name")
      .eq("user_id", userId).eq("is_miscellaneous", true).maybeSingle();
    if (!misc) {
      const { data: created } = await supabase
        .from("clients").insert({ user_id: userId, client_name: "מזדמנים", is_miscellaneous: true })
        .select("id, client_name").single();
      misc = created ?? null;
    }
    if (!misc) {
      await sendWhatsAppMessage(userPhone, "❗ לא הצלחתי ליצור לקוח \"מזדמנים\".", {
        fromPhone: businessPhone, supabase, userId,
        incomingMessageId: incomingMessageId ?? open.message_id,
      });
      return { kind: "reprompted" };
    }
    targetClientId = misc.id;
    confirmName = misc.client_name;
    resolution = "misc";
  } else if (mode === "create") {
    const norm = normalize(nameArg!);
    // Include ARCHIVED clients in the dup check so we don't crash on the unique constraint.
    const { data: existingClients } = await supabase
      .from("clients").select("id, client_name, is_archived")
      .eq("user_id", userId);
    const existing = (existingClients ?? []).find((c) => normalize(c.client_name) === norm);
    if (existing) {
      if (existing.is_archived) {
        // Auto-restore the archived client and reuse it.
        await supabase.from("clients").update({ is_archived: false }).eq("id", existing.id);
      }
      targetClientId = existing.id;
      confirmName = existing.client_name;
      resolution = "matched";
    } else {
      const { data: created, error: createErr } = await supabase
        .from("clients").insert({ user_id: userId, client_name: nameArg!, is_miscellaneous: false })
        .select("id, client_name").single();
      if (createErr || !created) {
        await sendWhatsAppMessage(userPhone, `❗ לא הצלחתי ליצור לקוח חדש: ${createErr?.message ?? "שגיאה"}`, {
          fromPhone: businessPhone, supabase, userId,
          incomingMessageId: incomingMessageId ?? open.message_id,
        });
        return { kind: "reprompted" };
      }
      targetClientId = created.id;
      confirmName = created.client_name;
      resolution = "created";
    }
  } else {
    const { clientId, matched } = await resolveClientId(supabase, userId, nameArg, nameArg!);
    if (!matched) {
      const suggestions = await suggestSimilarClients(supabase, userId, nameArg!);
      await sendWhatsAppMessage(userPhone, buildClarificationMessage(open.raw_text, suggestions).replace(
        "🤖 לא זיהיתי לאיזה לקוח לשייך את השליחות:",
        `❓ לא מצאתי לקוח בשם "${nameArg}". נסה/י שוב:`,
      ), {
        fromPhone: businessPhone, supabase, userId,
        incomingMessageId: incomingMessageId ?? open.message_id,
        replyType: "clarification_reprompt",
      });
      await supabase.from("pending_clarifications").update({
        reply_sent_at: new Date().toISOString(),
        reply_type: "reprompt",
      }).eq("id", open.id);
      return { kind: "reprompted" };
    }
    targetClientId = clientId;
    const { data: c } = await supabase.from("clients").select("client_name").eq("id", clientId).maybeSingle();
    confirmName = c?.client_name ?? nameArg!;
    resolution = "matched";
  }

  await supabase.from("deliveries").update({
    client_id: targetClientId,
    write_status: "pending",
    write_error: null,
  }).eq("id", del.id);

  const writeRes = await writeDeliveryToClientSheet(supabase, {
    deliveryId: del.id,
    messageId: del.message_id,
    userId: del.user_id,
    clientId: targetClientId!,
    delivery_date: del.delivery_date,
    description: del.description,
    contact_ordered_by: del.contact_ordered_by,
    notes: del.notes,
    price: del.price,
  });

  await supabase.from("pending_clarifications").update({
    resolved_at: new Date().toISOString(),
    resolution,
  }).eq("id", open.id);

  // Only mark "done" if the delivery actually landed in a sheet (or was already there).
  const isWritten = writeRes.writeStatus === "נכתב";
  await supabase.from("incoming_messages").update({
    status: isWritten ? "done" : "failed",
    error_detail: isWritten ? null : (writeRes.writeError ?? writeRes.writeStatus),
    processed_at: new Date().toISOString(),
  }).eq("id", del.message_id);

  if (isWritten) {
    await sendConfirmationIfNeeded(supabase, {
      toPhone: userPhone,
      fromPhone: businessPhone,
      userId,
      originalMessageId: del.message_id,
      clientName: confirmName,
      deliveryDate: del.delivery_date,
      description: del.description,
      price: del.price,
    });
  } else {
    const warn = `⚠️ לא הצלחתי לכתוב לגיליון של "${confirmName}": ${writeRes.writeError ?? writeRes.writeStatus}`;
    await sendWhatsAppMessage(userPhone, warn, {
      fromPhone: businessPhone, supabase, userId,
      incomingMessageId: incomingMessageId ?? del.message_id,
      replyType: "confirmation_failed",
    });
  }
  return { kind: "resolved", deliveryId: del.id };
}

function formatHebrewDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

async function sendConfirmationIfNeeded(
  supabase: DB,
  args: {
    toPhone: string;
    fromPhone?: string | null;
    userId: string;
    originalMessageId: string | null;
    clientName: string;
    deliveryDate: string;
    description: string;
    price: number | null;
  },
): Promise<void> {
  if (!args.originalMessageId) return;
  // Dedup: don't resend a successful confirmation for the same original message.
  const { data: prior } = await supabase
    .from("outbound_messages")
    .select("id")
    .eq("incoming_message_id", args.originalMessageId)
    .eq("reply_type", "confirmation_success")
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();
  if (prior) return;

  const priceLine = args.price == null ? "מחיר: לא צוין" : `מחיר: ${args.price} ₪`;
  const body = [
    `נוספה שורה ללקוח: ${args.clientName}`,
    "",
    `תאריך: ${formatHebrewDate(args.deliveryDate)}`,
    `פירוט: ${args.description}`,
    priceLine,
    "",
    "השליחות נשמרה בהצלחה.",
  ].join("\n");

  await sendWhatsAppMessage(args.toPhone, body, {
    fromPhone: args.fromPhone,
    supabase,
    userId: args.userId,
    incomingMessageId: args.originalMessageId,
    replyType: "confirmation_success",
  });
}


interface ParsedDelivery {
  client_name: string | null;
  description: string;
  price: number | null;
  delivery_date: string | null; // YYYY-MM-DD
  contact_ordered_by: string | null;
  notes: string | null;
  /** True only when the message explicitly mentions VAT (כולל מע"מ / לפני מע"מ / נטו / ברוטו / +מע"מ). */
  vat_explicit: boolean;
}

const SYSTEM_PROMPT = `You extract a single legal-document delivery task from a SHORT Hebrew WhatsApp message sent by an attorney/firm to a courier service.

Return STRICT JSON only, matching this schema:
{
  "client_name": string | null,         // The LAW FIRM / LAWYER that ORDERED the delivery (the sender's identification). NOT the recipient.
  "description": string,                // Short Hebrew description of WHAT to deliver and TO WHOM/WHERE.
  "price": number | null,               // See PRICE & VAT rules below. null if no price mentioned.
  "delivery_date": string | null,       // ISO date YYYY-MM-DD if mentioned. null = today.
  "contact_ordered_by": string | null,  // Name of the person who placed the order, if mentioned.
  "notes": string | null,               // Extra remarks. Append a VAT note when applicable (see below).
  "vat_explicit": boolean               // true ONLY if the message explicitly signals VAT, false otherwise.
}

CRITICAL RULES:
- Output JSON only. No markdown, no commentary.
- ALWAYS extract description, price, and date even if client_name is null. Extraction must still succeed.
- description is REQUIRED, non-empty Hebrew text describing the delivery task itself.
- client_name: ONLY the ordering firm/lawyer at the START of the message (e.g. "הלפר", "כהן ושות׳", "משרד X").
  * If the message starts directly with the task ("היום מסירה...", "מסירה ל...") → client_name = null. A name inside "ל[X]" is the RECIPIENT, not the client.
- Numbers in Hebrew words: "שמונים שקל"=80, "מאה"=100, "מאה וחמישים"=150, "מאתיים"=200, "חמישים"=50.
- Dates: "היום"=today, "מחר"=tomorrow. Use the provided "today" date as reference.

PRICE & VAT — VAT rate is 18%:
- DEFAULT (no VAT keyword): the courier means the FINAL agreed amount. Set "price" to the number as-is and set "vat_explicit"=false. Do NOT divide and do NOT multiply.
- Message says price WITH VAT ("כולל מע\"מ", "אחרי מע\"מ", "ברוטו"): divide by 1.18, round to 2 decimals, set "vat_explicit"=true, and add a note like "מחיר בהודעה: 40₪ כולל מע\"מ".
- Message says price BEFORE VAT ("לפני מע\"מ", "בלי מע\"מ", "+מע\"מ", "פלוס מע\"מ", "נטו"): use as-is, set "vat_explicit"=true, and add a note like "מחיר בהודעה: 40₪ לפני מע\"מ".

EXAMPLES:
Input: "היום מסירה לעורך דין לוי בבני ברק, שמונים שקל"
Output: {"client_name": null, "description": "מסירה לעורך דין לוי בבני ברק", "price": 80, "delivery_date": null, "contact_ordered_by": null, "notes": null, "vat_explicit": false}

Input: "כהן ושות׳ — מחר מסירה לבית משפט השלום ת״א, 120 לפני מע\"מ"
Output: {"client_name": "כהן ושות׳", "description": "מסירה לבית משפט השלום ת״א", "price": 120, "delivery_date": null, "contact_ordered_by": null, "notes": "מחיר בהודעה: 120₪ לפני מע\"מ", "vat_explicit": true}`;

async function callLovableAI(rawText: string): Promise<ParsedDelivery> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const today = israelToday();
  const userPrompt = `today=${today}\n\nMESSAGE:\n${rawText}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.AI_EXTRACTION_MODEL || "google/gemini-2.5-pro",
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
    vat_explicit: parsed.vat_explicit === true,
  };
}

function normalize(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/["'״׳`]/g, "")
    .replace(/[,.;:!?()[\]{}<>/\\|+*=~"'–—\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
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

  // Fallback: scan the raw message text for any alias or client name (token-boundary match)
  const textTokens = ` ${tokenize(rawText).join(" ")} `;
  const candidates = new Set<string>();
  for (const a of allAliases) {
    const p = tokenize(a.alias).join(" ");
    if (p && textTokens.includes(` ${p} `)) candidates.add(a.client_id);
  }
  for (const c of activeClients) {
    if (c.is_miscellaneous) continue;
    const p = tokenize(c.client_name).join(" ");
    if (p && textTokens.includes(` ${p} `)) candidates.add(c.id);
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
  let writtenSheetName: string | null = null;
  let writtenRowNumber: number | null = null;

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
      // Pull the persisted vat_explicit flag from the delivery row.
      const { data: delRow, error: delRowErr } = await supabase
        .from("deliveries")
        .select("written_sheet_ids, vat_explicit")
        .eq("id", delivery.deliveryId)
        .maybeSingle();
      if (delRowErr) throw delRowErr;
      const already = (delRow?.written_sheet_ids ?? []) as string[];
      // vat_explicit column added in migration; fall back to false if not yet present.
      const vatExplicit = Boolean((delRow as Record<string, unknown> | null)?.vat_explicit);

      const vatRate = await loadVatRate(supabase, delivery.userId);

      // Secondary guard — primary dedup happens on the H column inside the sheet writer.
      if (already.includes(sheetId)) {
        writeStatus = "נכתב";
      } else {
        const result = await appendDeliveryToSheet(
          sheetId,
          {
            delivery_date: delivery.delivery_date,
            description: delivery.description,
            contact_ordered_by: delivery.contact_ordered_by,
            notes: delivery.notes,
            price: delivery.price,
            vat_explicit: vatExplicit,
            message_id: delivery.messageId,
          },
          vatRate,
        );
        if (result.ok) {
          writeStatus = "נכתב";
          writtenSheetId = sheetId;
          writtenSheetName = result.sheetName ?? null;
          writtenRowNumber = result.rowNumber ?? null;
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

  let newWrittenSheetIds: string[] | null = null;
  if (writtenSheetId) {
    const { data: cur } = await supabase
      .from("deliveries")
      .select("written_sheet_ids")
      .eq("id", delivery.deliveryId)
      .maybeSingle();
    const existing = ((cur?.written_sheet_ids ?? []) as string[]).filter((s) => s !== writtenSheetId);
    newWrittenSheetIds = [...existing, writtenSheetId];
  }
  const { error: updateDeliveryErr } = await supabase.from("deliveries").update({
    write_status: writeStatus,
    write_error: writeError,
    written_at: writeStatus === "נכתב" ? new Date().toISOString() : null,
    ...(newWrittenSheetIds ? { written_sheet_ids: newWrittenSheetIds } : {}),
    ...(writtenSheetName ? { sheet_name: writtenSheetName } : {}),
    ...(writtenRowNumber ? { row_number: writtenRowNumber } : {}),
  }).eq("id", delivery.deliveryId);
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
  status: "done" | "missing_client" | "missing_details" | "failed" | "awaiting_clarification";
  deliveryId?: string;
  errorMessage?: string;
}

export async function processIncomingMessage(
  supabase: DB,
  messageId: string,
  businessPhone?: string | null,
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

    const deliveryDate = isValidIsoDate(parsed.delivery_date) ? parsed.delivery_date : israelToday();

    const { data: existingDelivery, error: existingErr } = await supabase
      .from("deliveries")
      .select("id, message_id, user_id, client_id, delivery_date, description, contact_ordered_by, notes, price, write_status")
      .eq("message_id", messageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) throw existingErr;
    let delivery: { id: string } | null = null;

    if (existingDelivery) {
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

      if (matched) {
        if (existingDelivery.write_status !== "נכתב") {
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
          status: "done", error_detail: null, processed_at: new Date().toISOString(),
        }).eq("id", messageId);
        return { ok: true, status: "done", deliveryId: existingDelivery.id };
      }
      delivery = { id: existingDelivery.id };
    } else if (matched) {
      const { data: newDelivery, error: delErr } = await supabase.from("deliveries").insert({
        message_id: messageId,
        client_id: clientId,
        user_id: msg.user_id,
        delivery_date: deliveryDate,
        description: parsed.description,
        notes: parsed.notes,
        price: parsed.price,
        price_missing: parsed.price == null,
        vat_explicit: parsed.vat_explicit,
        contact_ordered_by: parsed.contact_ordered_by,
        write_status: "pending",
      }).select("id").single();
      if (delErr) throw delErr;
      await writeDeliveryToClientSheet(supabase, {
        deliveryId: newDelivery.id,
        messageId,
        userId: msg.user_id,
        clientId,
        delivery_date: deliveryDate,
        description: parsed.description,
        contact_ordered_by: parsed.contact_ordered_by,
        notes: parsed.notes,
        price: parsed.price,
      });
      await supabase.from("incoming_messages").update({
        status: "done", error_detail: null, processed_at: new Date().toISOString(),
      }).eq("id", messageId);
      return { ok: true, status: "done", deliveryId: newDelivery.id };
    } else {
      const { data: newDelivery, error: delErr } = await supabase.from("deliveries").insert({
        message_id: messageId,
        client_id: clientId,
        user_id: msg.user_id,
        delivery_date: deliveryDate,
        description: parsed.description,
        notes: parsed.notes,
        price: parsed.price,
        price_missing: parsed.price == null,
        vat_explicit: parsed.vat_explicit,
        contact_ordered_by: parsed.contact_ordered_by,
        write_status: "awaiting_clarification",
      }).select("id").single();
      if (delErr) throw delErr;
      delivery = { id: newDelivery.id };
    }


    // Not matched → start (or continue) a clarification flow via WhatsApp.
    await expireStaleClarifications(supabase, msg.user_id);

    // Reuse an already-open clarification for this message if it exists (reprocess case).
    const { data: existingClarif } = await supabase
      .from("pending_clarifications")
      .select("id, reply_sent_at")
      .eq("user_id", msg.user_id)
      .eq("message_id", messageId)
      .is("resolved_at", null)
      .maybeSingle();

    let clarifId: string | null = existingClarif?.id ?? null;
    let alreadyPrompted = !!existingClarif?.reply_sent_at;
    if (!clarifId) {
      const { data: newRow, error: clarifErr } = await supabase.from("pending_clarifications").insert({
        user_id: msg.user_id,
        message_id: messageId,
        delivery_id: delivery!.id,
        raw_text: text,
      }).select("id").single();
      if (clarifErr) throw clarifErr;
      clarifId = newRow.id;
    }

    // Dedup: don't re-send the same initial prompt for the same message.
    let clarificationSent = alreadyPrompted;
    let waError: string | null = null;
    if (!alreadyPrompted && msg.sender_phone) {
      const suggestions = await suggestSimilarClients(supabase, msg.user_id, parsed.client_name ?? text);
      const send = await sendWhatsAppMessage(
        msg.sender_phone,
        buildClarificationMessage(text, suggestions),
        {
          fromPhone: businessPhone,
          supabase,
          userId: msg.user_id,
          incomingMessageId: messageId,
          replyType: "clarification_prompt",
        },
      );
      clarificationSent = send.ok;
      waError = send.ok ? null : (send.error ?? "שליחת WhatsApp נכשלה");
      if (send.ok && clarifId) {
        await supabase.from("pending_clarifications").update({
          reply_sent_at: new Date().toISOString(),
          reply_type: "initial",
        }).eq("id", clarifId);
      }
    }

    if (clarificationSent) {
      await supabase.from("incoming_messages").update({
        status: "awaiting_clarification",
        error_detail: "ממתין להבהרה דרך WhatsApp",
        processed_at: new Date().toISOString(),
      }).eq("id", messageId);
      return { ok: true, status: "awaiting_clarification", deliveryId: delivery!.id };
    }

    // Could not reach WhatsApp → keep awaiting_clarification, do NOT write to sheet yet.
    const errDetail = `לא זוהה לקוח. שליחת הבהרה ב-WhatsApp נכשלה: ${waError ?? "לא ידוע"}`;
    await supabase.from("incoming_messages").update({
      status: "awaiting_clarification", error_detail: errDetail, processed_at: new Date().toISOString(),
    }).eq("id", messageId);
    await supabase.from("processing_errors").insert({
      message_id: messageId, user_id: msg.user_id,
      error_type: "clarification_send_failed",
      error_description: errDetail,
    });
    return { ok: true, status: "awaiting_clarification", deliveryId: delivery!.id };
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
