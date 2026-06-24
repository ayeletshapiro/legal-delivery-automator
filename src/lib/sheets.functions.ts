import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SheetsStatus {
  connected: boolean;
  outcome: "verified" | "skipped" | "failed" | "missing_key" | "error";
  latency_ms?: number;
  error?: string;
}

export const getSheetsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<SheetsStatus> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const connKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!lovableKey || !connKey) {
      return {
        connected: false,
        outcome: "missing_key",
        error: !connKey ? "Google Sheets לא מחובר" : "מפתח Lovable חסר",
      };
    }
    try {
      const resp = await fetch("https://connector-gateway.lovable.dev/api/v1/verify_credentials", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": connKey,
          "Content-Type": "application/json",
        },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { connected: false, outcome: "error", error: `שגיאה ${resp.status}: ${body.slice(0, 200)}` };
      }
      const data = (await resp.json()) as { outcome: "verified" | "skipped" | "failed"; latency_ms?: number; error?: string };
      return {
        connected: data.outcome === "verified" || data.outcome === "skipped",
        outcome: data.outcome,
        latency_ms: data.latency_ms,
        error: data.error,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה לא ידועה";
      return { connected: false, outcome: "error", error: msg };
    }
  });
