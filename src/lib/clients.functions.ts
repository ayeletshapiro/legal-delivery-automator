import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listClients = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("clients")
      .select("*")
      .order("is_archived", { ascending: true })
      .order("client_name", { ascending: true });
    if (error) throw error;
    return data;
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_name: string; google_sheet_id?: string | null }) =>
    z.object({
      client_name: z.string().trim().min(1, "שם לקוח חובה"),
      google_sheet_id: z.string().trim().nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("clients")
      .insert({
        client_name: data.client_name,
        google_sheet_id: data.google_sheet_id || null,
        user_id: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; client_name: string; google_sheet_id?: string | null }) =>
    z.object({
      id: z.string().uuid(),
      client_name: z.string().trim().min(1),
      google_sheet_id: z.string().trim().nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clients")
      .update({ client_name: data.client_name, google_sheet_id: data.google_sheet_id || null })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const archiveClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; archive: boolean }) =>
    z.object({ id: z.string().uuid(), archive: z.boolean() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("clients")
      .update({ is_archived: data.archive })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
