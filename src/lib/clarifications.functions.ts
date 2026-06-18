import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listOpenClarifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("pending_clarifications")
      .select("id, message_id, delivery_id, raw_text, created_at, reply_sent_at, reply_type, incoming_messages(sender_phone, status, raw_text, transcribed_text)")
      .is("resolved_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });

export const countOpenClarifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count } = await context.supabase
      .from("pending_clarifications")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null);
    return { count: count ?? 0 };
  });

export const cancelClarification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("pending_clarifications")
      .select("id, message_id, delivery_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("בירור לא נמצא");

    await context.supabase.from("pending_clarifications").update({
      resolved_at: new Date().toISOString(),
      resolution: "cancelled",
    }).eq("id", row.id);
    if (row.delivery_id) {
      await context.supabase.from("deliveries").delete().eq("id", row.delivery_id);
    }
    await context.supabase.from("incoming_messages").update({
      status: "cancelled",
      error_detail: "הבירור בוטל ידנית מהדשבורד",
      processed_at: new Date().toISOString(),
    }).eq("id", row.message_id);
    return { ok: true };
  });

export const listOutboundForMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("outbound_messages")
      .select("*")
      .eq("incoming_message_id", data.messageId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows;
  });
