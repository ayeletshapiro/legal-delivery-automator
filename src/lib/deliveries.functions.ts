import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listDeliveries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    from?: string | null;
    to?: string | null;
    client_id?: string | null;
    write_status?: string | null;
  }) =>
    z.object({
      from: z.string().nullable().optional(),
      to: z.string().nullable().optional(),
      client_id: z.string().uuid().nullable().optional(),
      write_status: z.string().nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const fetchRows = async () => {
      let q = context.supabase
        .from("deliveries")
        .select("*, clients(client_name)")
        .order("delivery_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(500);
      if (data.from) q = q.gte("delivery_date", data.from);
      if (data.to) q = q.lte("delivery_date", data.to);
      if (data.client_id) q = q.eq("client_id", data.client_id);
      if (data.write_status) q = q.eq("write_status", data.write_status);
      return q;
    };

    const { data: rows, error } = await fetchRows();
    if (error) throw error;
    const repairableRows = (rows ?? []).filter((row) => row.write_status === "ללא גיליון" && row.price != null);
    if (repairableRows.length > 0) {
      const { writeDeliveryToClientSheet } = await import("./processing.server");
      const repairedMessages = new Set<string>();
      for (const row of repairableRows) {
        const dedupeKey = row.message_id ?? row.id;
        if (repairedMessages.has(dedupeKey)) {
          await context.supabase.from("deliveries").update({
            write_status: "skipped",
            write_error: "דולג — הודעה כפולה שכבר עובדה",
            written_at: null,
          }).eq("id", row.id);
          continue;
        }
        repairedMessages.add(dedupeKey);
        await writeDeliveryToClientSheet(context.supabase, {
          deliveryId: row.id,
          messageId: row.message_id,
          userId: context.userId,
          clientId: row.client_id,
          delivery_date: row.delivery_date,
          description: row.description,
          contact_ordered_by: row.contact_ordered_by,
          notes: row.notes,
          price: row.price,
        });
      }
      const { data: refreshedRows, error: refreshedError } = await fetchRows();
      if (refreshedError) throw refreshedError;
      return refreshedRows;
    }
    return rows;
  });

export const updateDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id: string;
    client_id?: string;
    delivery_date?: string;
    description?: string;
    notes?: string | null;
    price?: number | null;
    contact_ordered_by?: string | null;
    write_status?: string;
  }) =>
    z.object({
      id: z.string().uuid(),
      client_id: z.string().uuid().optional(),
      delivery_date: z.string().optional(),
      description: z.string().min(1).optional(),
      notes: z.string().nullable().optional(),
      price: z.number().nullable().optional(),
      contact_ordered_by: z.string().nullable().optional(),
      write_status: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { id, price, ...rest } = data;
    const update: {
      client_id?: string;
      delivery_date?: string;
      description?: string;
      notes?: string | null;
      price?: number | null;
      price_missing?: boolean;
      contact_ordered_by?: string | null;
      write_status?: string;
    } = { ...rest };
    if ("price" in data) {
      update.price = price ?? null;
      update.price_missing = price == null;
    }
    const { error } = await context.supabase
      .from("deliveries")
      .update(update)
      .eq("id", id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("deliveries").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
