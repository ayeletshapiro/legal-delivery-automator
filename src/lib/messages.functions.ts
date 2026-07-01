import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string | null }) =>
    z.object({ status: z.string().nullable().optional() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("incoming_messages")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status) q = q.eq("status", data.status as any);
    const { data: rows, error } = await q;
    if (error) throw error;

    // Fetch delivery write statuses for these messages in a single query.
    const messageIds = (rows ?? []).map((r) => r.id);
    let deliveryStatusById = new Map<string, string>();
    if (messageIds.length > 0) {
      const { data: dels } = await context.supabase
        .from("deliveries")
        .select("message_id, write_status")
        .in("message_id", messageIds);
      for (const d of dels ?? []) {
        if (d.message_id) deliveryStatusById.set(d.message_id, d.write_status);
      }
    }

    return (rows ?? []).map((r) => ({
      ...r,
      delivery_write_status: deliveryStatusById.get(r.id) ?? null,
    }));
  });
