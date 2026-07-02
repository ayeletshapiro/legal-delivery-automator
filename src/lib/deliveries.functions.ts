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
    const { data: rows, error } = await q;
    if (error) throw error;
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

export const retryDeliveryWrite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("deliveries")
      .select("id, message_id, user_id, client_id, delivery_date, description, contact_ordered_by, notes, price")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("שליחות לא נמצאה");
    if (row.user_id !== context.userId) throw new Error("אין הרשאה לבצע פעולה זו");
    const { writeDeliveryToClientSheet } = await import("./processing.server");
    const res = await writeDeliveryToClientSheet(context.supabase, {
      deliveryId: row.id,
      messageId: row.message_id,
      userId: row.user_id,
      clientId: row.client_id,
      delivery_date: row.delivery_date,
      description: row.description,
      contact_ordered_by: row.contact_ordered_by,
      notes: row.notes,
      price: row.price,
      checkDuplicate: true,
    });
    return { ok: res.writeStatus === "נכתב", writeStatus: res.writeStatus, writeError: res.writeError };
  });

export const repairFailedWrites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("deliveries")
      .select("id, message_id, user_id, client_id, delivery_date, description, contact_ordered_by, notes, price")
      .eq("user_id", context.userId)
      .in("write_status", ["שגיאה", "ללא גיליון"])
      .order("created_at", { ascending: true })
      .limit(3);
    if (error) throw error;
    const list = rows ?? [];
    let repaired = 0;
    if (list.length === 0) return { attempted: 0, repaired: 0 };
    const { writeDeliveryToClientSheet } = await import("./processing.server");
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      try {
        const res = await writeDeliveryToClientSheet(context.supabase, {
          deliveryId: row.id,
          messageId: row.message_id,
          userId: row.user_id,
          clientId: row.client_id,
          delivery_date: row.delivery_date,
          description: row.description,
          contact_ordered_by: row.contact_ordered_by,
          notes: row.notes,
          price: row.price,
          checkDuplicate: true,
        });
        if (res.writeStatus === "נכתב") repaired++;
      } catch {
        // Swallow per-row failures so one bad row never blocks the others.
      }
      if (i < list.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return { attempted: list.length, repaired };
  });


