import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const wipeDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("רק אדמין יכול לבצע ניקוי נתוני דמו");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const counts: Record<string, number> = {};
    const wipe = async (
      table:
        | "pending_clarifications"
        | "outbound_messages"
        | "processing_errors"
        | "deliveries"
        | "incoming_messages"
        | "client_aliases",
    ) => {
      const { count } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true });
      counts[table] = count ?? 0;
      const { error } = await supabaseAdmin
        .from(table)
        .delete()
        .not("id", "is", null);
      if (error) throw error;
    };

    await wipe("pending_clarifications");
    await wipe("outbound_messages");
    await wipe("processing_errors");
    await wipe("deliveries");
    await wipe("incoming_messages");
    await wipe("client_aliases");

    const { count: clientsCount } = await supabaseAdmin
      .from("clients")
      .select("*", { count: "exact", head: true })
      .eq("is_miscellaneous", false);
    counts.clients = clientsCount ?? 0;
    const { error: clientsErr } = await supabaseAdmin
      .from("clients")
      .delete()
      .eq("is_miscellaneous", false);
    if (clientsErr) throw clientsErr;

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    const { data: logRow, error: logErr } = await supabaseAdmin
      .from("admin_audit_log")
      .insert({
        action: "wipe_demo_data",
        performed_by: context.userId,
        performed_by_email: profile?.email ?? null,
        details: { deleted: counts },
      })
      .select("created_at")
      .single();
    if (logErr) throw logErr;

    return { ok: true, deleted: counts, performed_at: logRow.created_at };
  });

export const getLastDemoWipe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) return null;

    const { data, error } = await context.supabase
      .from("admin_audit_log")
      .select("created_at, performed_by_email, details")
      .eq("action", "wipe_demo_data")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

/**
 * Re-run processing for every message of the current user that is currently
 * stuck at status='missing_client'. Intended for a one-off cleanup after the
 * "עבור X / הזמין Y" resolver fix — messages in other statuses are untouched.
 */
export const reprocessMissingClientMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("רק אדמין יכול להריץ מחדש הודעות");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { processIncomingMessage } = await import("./processing.server");

    const { data: rows, error } = await supabaseAdmin
      .from("incoming_messages")
      .select("id")
      .eq("status", "missing_client")
      .order("created_at", { ascending: true });
    if (error) throw error;

    const ids = (rows ?? []).map((r) => r.id);
    let succeeded = 0;
    let stillMissing = 0;
    let failed = 0;
    const details: Array<{ id: string; status: string; error?: string }> = [];

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        const res = await processIncomingMessage(supabaseAdmin, id);
        if (res.status === "done") succeeded++;
        else if (res.status === "missing_client") stillMissing++;
        else failed++;
        details.push({ id, status: res.status, error: res.errorMessage });
      } catch (e) {
        failed++;
        details.push({ id, status: "failed", error: e instanceof Error ? e.message : String(e) });
      }
      if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 400));
    }

    return { attempted: ids.length, succeeded, stillMissing, failed, details };
  });
