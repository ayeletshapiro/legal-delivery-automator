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
          return new Response(JSON.stringify({ error: "Webhook not configured" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }

        const rawBody = await request.text();
        const params: Record<string, string> = {};
        const usp = new URLSearchParams(rawBody);
        for (const [k, v] of usp.entries()) params[k] = v;

        const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
        const host =
          request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
        const pathAndQuery = new URL(request.url).pathname + new URL(request.url).search;
        const fullUrl = `${proto}://${host}${pathAndQuery}`;

        const provided = request.headers.get("x-twilio-signature") ?? "";
        const expected = computeTwilioSignature(authToken, fullUrl, params);
        if (!provided || !safeEqualB64(provided, expected)) {
          console.warn("[twilio-webhook] invalid signature", { fullUrl });
          return new Response(JSON.stringify({ error: "Invalid signature" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          });
        }

        const messageSid = params["MessageSid"] || params["SmsMessageSid"] || params["SmsSid"];
        const from = params["From"];
        if (!messageSid || !from) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const senderPhone = stripWhatsAppPrefix(from);
        const numMedia = Number(params["NumMedia"] ?? "0") || 0;
        const messageType = detectMessageType(numMedia, params["MediaContentType0"]);
        const rawText = params["Body"] ?? null;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id")
          .eq("whatsapp_phone", senderPhone)
          .maybeSingle();

        const { data: inserted, error } = await supabaseAdmin
          .from("incoming_messages")
          .insert({
            whatsapp_message_id: messageSid,
            sender_phone: senderPhone,
            message_type: messageType,
            raw_text: rawText,
            media_received: numMedia > 0,
            status: "received",
            user_id: profile?.id ?? null,
          })
          .select("id")
          .single();

        if (error) {
          if (error.code === "23505") {
            // duplicate — idempotent OK
            return new Response("<Response/>", {
              status: 200,
              headers: { "content-type": "text/xml" },
            });
          }
          console.error("[twilio-webhook] insert error", error);
          return new Response(JSON.stringify({ error: "DB error" }), { status: 500 });
        }

        const businessPhone = stripWhatsAppPrefix(params["To"] ?? "");

        // Auto-process messages that carry text we can parse. This covers:
        //  - plain text messages
        //  - image/document messages that include a caption (Body)
        // Audio is handled separately below (needs transcription first).
        const hasParsableText = messageType !== "audio" && !!rawText && rawText.trim().length > 0;
        if (inserted && profile?.id && hasParsableText) {
          try {
            const { processIncomingMessage } = await import("@/lib/processing.server");
            await processIncomingMessage(supabaseAdmin, inserted.id, businessPhone);
          } catch (e) {
            console.error("[twilio-webhook] auto-process error", e);
          }
        }

        // Audio: download + transcribe via Lovable AI, then process like text.
        if (inserted && messageType === "audio" && numMedia > 0) {
          const mediaUrl = params["MediaUrl0"];
          const mediaContentType = (params["MediaContentType0"] ?? "audio/ogg").toLowerCase();
          const accountSid = params["AccountSid"];
          try {
            if (!mediaUrl) throw new Error("MediaUrl0 חסר");
            if (!accountSid) throw new Error("AccountSid חסר");
            const lovableKey = process.env.LOVABLE_API_KEY;
            if (!lovableKey) throw new Error("LOVABLE_API_KEY לא מוגדר");

            const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
            const mediaResp = await fetch(mediaUrl, {
              headers: { Authorization: `Basic ${basic}` },
              redirect: "follow",
            });
            if (!mediaResp.ok) {
              const t = await mediaResp.text().catch(() => "");
              throw new Error(`הורדת מדיה מטוויליו נכשלה ${mediaResp.status}: ${t.slice(0, 200)}`);
            }
            const audioBuf = await mediaResp.arrayBuffer();

            const extMap: Record<string, string> = {
              "audio/ogg": "ogg",
              "audio/opus": "ogg",
              "audio/mpeg": "mp3",
              "audio/mp3": "mp3",
              "audio/mp4": "mp4",
              "audio/m4a": "m4a",
              "audio/x-m4a": "m4a",
              "audio/wav": "wav",
              "audio/x-wav": "wav",
              "audio/webm": "webm",
              "audio/aac": "aac",
              "audio/flac": "flac",
            };
            const baseType = mediaContentType.split(";")[0].trim();
            const ext = extMap[baseType] ?? "ogg";
            const filename = `recording.${ext}`;

            const fd = new FormData();
            fd.append("file", new Blob([audioBuf], { type: baseType }), filename);
            fd.append("model", process.env.TRANSCRIPTION_MODEL || "openai/gpt-4o-transcribe");
            fd.append("language", "he");

            const sttResp = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
              method: "POST",
              headers: { Authorization: `Bearer ${lovableKey}` },
              body: fd,
            });
            if (!sttResp.ok) {
              const t = await sttResp.text().catch(() => "");
              throw new Error(`תמלול נכשל ${sttResp.status}: ${t.slice(0, 300)}`);
            }
            const sttJson = await sttResp.json();
            const transcript: string = (sttJson?.text ?? "").toString().trim();
            if (!transcript) throw new Error("התמלול חזר ריק");

            await supabaseAdmin
              .from("incoming_messages")
              .update({ transcribed_text: transcript })
              .eq("id", inserted.id);

            if (profile?.id) {
              try {
                const { processIncomingMessage } = await import("@/lib/processing.server");
                await processIncomingMessage(supabaseAdmin, inserted.id, businessPhone);
              } catch (e) {
                console.error("[twilio-webhook] audio auto-process error", e);
              }
            }
          } catch (e) {
            const reason = e instanceof Error ? e.message : "שגיאה לא ידועה בתמלול";
            console.error("[twilio-webhook] transcription error", reason);
            await supabaseAdmin
              .from("incoming_messages")
              .update({
                status: "transcription_failed",
                error_detail: reason,
                processed_at: new Date().toISOString(),
              })
              .eq("id", inserted.id);
            await supabaseAdmin.from("processing_errors").insert({
              message_id: inserted.id,
              user_id: profile?.id ?? null,
              error_type: "transcription_failed",
              error_description: reason,
            });
            try {
              const { sendWhatsAppMessage } = await import("@/lib/twilio.server");
              await sendWhatsAppMessage(senderPhone, "❗ לא הצלחתי לתמלל את ההודעה הקולית. אפשר/י לשלוח שוב כטקסט?", {
                fromPhone: businessPhone,
                supabase: supabaseAdmin,
                userId: profile?.id ?? null,
                incomingMessageId: inserted.id,
                replyType: "transcription_failed",
              });
            } catch (notifyErr) {
              console.error("[twilio-webhook] transcription failure notify error", notifyErr);
            }
          }
        }

        return new Response("<Response/>", {
          status: 200,
          headers: { "content-type": "text/xml" },
        });
      },
    },
  },
});
