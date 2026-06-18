import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listAliases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("client_aliases")
      .select("*, clients(client_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  });

export const createAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { client_id: string; alias: string }) =>
    z.object({
      client_id: z.string().uuid(),
      alias: z.string().trim().min(1, "כינוי חובה"),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("client_aliases")
      .insert({ client_id: data.client_id, alias: data.alias, user_id: context.userId });
    if (error) {
      if (error.code === "23505") throw new Error("הכינוי כבר קיים");
      throw error;
    }
    return { ok: true };
  });

export const deleteAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("client_aliases").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
