import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Twilio WhatsApp webhook.
 * - If TWILIO_AUTH_TOKEN is not configured → 503 (endpoint closed).
 * - Validates X-Twilio-Signature using the official Twilio algorithm.
 * - Parses application/x-www-form-urlencoded body sent by Twilio.
 * - Maps Twilio fields to our incoming_messages table.
 */

function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>) {
  // Twilio algorithm: full URL + concatenated (sorted key + value) for all POST params,
  // HMAC-SHA1, base64.
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];
  return createHmac("sha1", authToken).update(data).digest("base64");
}

function safeEqualB64(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function detectMessageType(numMedia: number, contentType: string | undefined): "text" | "audio" | "image" | "document" {
  if (numMedia === 0) return "text";
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("audio/")) return "audio";
  if (ct.startsWith("image/")) return "image";
  return "document";
}

function stripWhatsAppPrefix(p: string) {
  return p.replace(/^whatsapp:/i, "").trim();
}

export const Route = createFileRoute("/api/public/twilio-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!authToken) {
          return new Response(
            JSON.stringify({ error: "Webhook not configured" }),
            { status: 503, headers: { "content-type": "application/json" } }
          );
        }

        // Read raw body (Twilio sends form-urlencoded)
        const rawBody = await request.text();
        const params: Record<string, string> = {};
        const usp = new URLSearchParams(rawBody);
        for (const [k, v] of usp.entries()) params[k] = v;

        // Reconstruct the full URL as Twilio sees it.
        // Twilio signs the URL it called. Behind a proxy the request URL host
        // may differ; prefer X-Forwarded-* headers when present.
        const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
        const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
        const pathAndQuery = new URL(request.url).pathname + new URL(request.url).search;
        const fullUrl = `${proto}://${host}${pathAndQuery}`;

        const provided = request.headers.get("x-twilio-signature") ?? "";
        const expected = computeTwilioSignature(authToken, fullUrl, params);
        if (!provided || !safeEqualB64(provided, expected)) {
          console.warn("[twilio-webhook] invalid signature", { fullUrl });
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 403, headers: { "content-type": "application/json" },
          });
        }

        const messageSid = params["MessageSid"] || params["SmsMessageSid"] || params["SmsSid"];
        const from = params["From"];
        if (!messageSid || !from) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400, headers: { "content-type": "application/json" },
          });
        }

        const senderPhone = stripWhatsAppPrefix(from);
        const numMedia = Number(params["NumMedia"] ?? "0") || 0;
        const messageType = detectMessageType(numMedia, params["MediaContentType0"]);
        const rawText = params["Body"] ?? null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Map sender_phone → user_id via profiles.whatsapp_phone (if registered)
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("whatsapp_phone", senderPhone)
          .maybeSingle();

        const { error } = await supabaseAdmin.from("incoming_messages").insert({
          whatsapp_message_id: messageSid,
          sender_phone: senderPhone,
          message_type: messageType,
          raw_text: rawText,
          media_received: numMedia > 0,
          status: "received",
          user_id: profile?.id ?? null,
        });

        if (error) {
          if (error.code === "23505") {
            // duplicate — idempotent OK
            return new Response("<Response/>", {
              status: 200, headers: { "content-type": "text/xml" },
            });
          }
          console.error("[twilio-webhook] insert error", error);
          return new Response(JSON.stringify({ error: "DB error" }), { status: 500 });
        }

        // Twilio expects TwiML or empty 200. Return empty TwiML.
        return new Response("<Response/>", {
          status: 200, headers: { "content-type": "text/xml" },
        });
      },
    },
  },
});
