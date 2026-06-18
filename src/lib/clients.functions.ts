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
    const patch: { client_name: string; google_sheet_id?: string | null } = { client_name: data.client_name };
    if (data.google_sheet_id !== undefined) patch.google_sheet_id = data.google_sheet_id || null;
    const { error } = await context.supabase
      .from("clients")
      .update(patch)
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

export const importClientsWithAliases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rows: Array<{ client_name: string; alias?: string | null }> }) =>
    z.object({
      rows: z.array(z.object({
        client_name: z.string().trim().min(1),
        alias: z.string().trim().nullable().optional(),
      })).min(1),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;
    const userId = context.userId;

    // Load existing clients (for this user) once
    const { data: existing, error: exErr } = await supabase
      .from("clients")
      .select("id, client_name")
      .eq("user_id", userId);
    if (exErr) throw exErr;
    const byName = new Map<string, string>();
    for (const c of existing ?? []) byName.set(c.client_name.trim().toLowerCase(), c.id);

    // Group rows by client_name → aliases[]
    const grouped = new Map<string, Set<string>>();
    for (const r of data.rows) {
      const name = r.client_name.trim();
      if (!name) continue;
      if (!grouped.has(name)) grouped.set(name, new Set());
      const a = (r.alias ?? "").trim();
      if (a) grouped.get(name)!.add(a);
    }

    let createdClients = 0;
    let createdAliases = 0;
    let skippedAliases = 0;

    for (const [name, aliases] of grouped) {
      const key = name.toLowerCase();
      let clientId = byName.get(key);
      if (!clientId) {
        const { data: row, error } = await supabase
          .from("clients")
          .insert({ client_name: name, user_id: userId })
          .select("id")
          .single();
        if (error) throw error;
        clientId = row.id;
        byName.set(key, clientId);
        createdClients++;
      }

      for (const a of aliases) {
        const { error } = await supabase
          .from("client_aliases")
          .insert({ client_id: clientId, alias: a, user_id: userId });
        if (error) {
          if (error.code === "23505") { skippedAliases++; continue; }
          throw error;
        }
        createdAliases++;
      }
    }

    return { createdClients, createdAliases, skippedAliases };
  });

