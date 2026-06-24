import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getConfig, updateVatRate } from "@/lib/config.functions";
import { getProfile, updateWhatsappPhone } from "@/lib/profile.functions";
import { wipeDemoData, getLastDemoWipe } from "@/lib/admin.functions";
import { getSheetsStatus } from "@/lib/sheets.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Settings, User, Percent, ShieldCheck, Phone, Lock, Trash2, FileSpreadsheet, CheckCircle2, XCircle, RefreshCw, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

/** Initials for the avatar from an email or name. */
function initials(value: string): string {
  const name = value.split("@")[0];
  const parts = name.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function SettingsPage() {
  const qc = useQueryClient();
  const cfgFn = useServerFn(getConfig);
  const vatFn = useServerFn(updateVatRate);
  const profFn = useServerFn(getProfile);
  const phoneFn = useServerFn(updateWhatsappPhone);

  const wipeFn = useServerFn(wipeDemoData);
  const lastWipeFn = useServerFn(getLastDemoWipe);
  const sheetsStatusFn = useServerFn(getSheetsStatus);

  const sheets = useQuery({
    queryKey: ["sheets-status"],
    queryFn: () => sheetsStatusFn(),
    refetchOnWindowFocus: false,
  });

  const cfg = useQuery({ queryKey: ["config"], queryFn: () => cfgFn() });
  const prof = useQuery({ queryKey: ["profile"], queryFn: () => profFn() });
  const isAdminRole = prof.data?.roles.includes("admin") ?? false;
  const lastWipe = useQuery({
    queryKey: ["last-demo-wipe"],
    queryFn: () => lastWipeFn(),
    enabled: isAdminRole,
  });

  const [vatPct, setVatPct] = useState("");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    if (cfg.data) setVatPct(((cfg.data.vat_rate ?? 0.18) * 100).toFixed(2));
  }, [cfg.data]);
  useEffect(() => {
    if (prof.data?.profile) setPhone(prof.data.profile.whatsapp_phone ?? "");
  }, [prof.data]);

  const vatMut = useMutation({
    mutationFn: (rate: number) => vatFn({ data: { vat_rate: rate } }),
    onSuccess: () => {
      toast.success('מע"מ עודכן');
      qc.invalidateQueries({ queryKey: ["config"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const phoneMut = useMutation({
    mutationFn: (p: string | null) => phoneFn({ data: { whatsapp_phone: p } }),
    onSuccess: () => {
      toast.success("טלפון עודכן");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isAdmin = isAdminRole;
  const email = prof.data?.profile?.email ?? "";

  const wipeMut = useMutation({
    mutationFn: () => wipeFn(),
    onSuccess: (res) => {
      const total = Object.values(res.deleted).reduce((a, b) => a + b, 0);
      toast.success(`נמחקו ${total} רשומות דמו`);
      qc.invalidateQueries({ queryKey: ["last-demo-wipe"] });
      qc.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
          <Settings className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h2 className="text-xl font-semibold leading-tight">הגדרות</h2>
          <p className="text-sm text-muted-foreground leading-tight">פרופיל אישי והגדרות מערכת</p>
        </div>
      </div>

      {/* Profile card */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-5 py-3">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">הפרופיל שלי</span>
        </div>
        <CardContent className="space-y-5 p-5">
          {/* Identity row */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-base font-medium text-emerald-700">
              {email ? initials(email) : "?"}
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">{email || "—"}</p>
              {isAdmin && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
                  <ShieldCheck className="h-3 w-3" />
                  אדמין
                </span>
              )}
            </div>
          </div>

          {/* WhatsApp phone */}
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5 text-muted-foreground" />
              מספר WhatsApp אישי
            </Label>
            <div className="flex gap-2">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="+972..." />
              <Button onClick={() => phoneMut.mutate(phone || null)} disabled={phoneMut.isPending}>
                שמור
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">משמש לזיהוי הודעות נכנסות מהמספר הזה.</p>
          </div>
        </CardContent>
      </Card>

      {/* VAT card */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-5 py-3">
          <Percent className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">מע"מ</span>
        </div>
        <CardContent className="space-y-2 p-5">
          <Label>אחוז מע"מ (%)</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={vatPct}
              onChange={(e) => setVatPct(e.target.value)}
              dir="ltr"
              disabled={!isAdmin}
            />
            <Button onClick={() => vatMut.mutate(Number(vatPct) / 100)} disabled={!isAdmin || vatMut.isPending}>
              שמור
            </Button>
          </div>
          {!isAdmin && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              רק אדמין יכול לשנות את אחוז המע"מ.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Admin: wipe demo data */}
      {isAdmin && (
        <Card className="overflow-hidden border-destructive/30">
          <div className="flex items-center gap-2 border-b bg-destructive/5 px-5 py-3">
            <Trash2 className="h-4 w-4 text-destructive" />
            <span className="font-medium">ניקוי נתוני דמו</span>
          </div>
          <CardContent className="space-y-3 p-5">
            <p className="text-sm text-muted-foreground">
              מוחק את כל הנתונים התפעוליים: מסירות, הודעות נכנסות/יוצאות, בירורים, שגיאות עיבוד, לקוחות (פרט ל"מזדמנים") וכינויים.
              משתמשים, הרשאות והגדרות נשמרים.
            </p>
            {lastWipe.data && (
              <p className="text-xs text-muted-foreground">
                ניקוי אחרון:{" "}
                {new Date(lastWipe.data.created_at).toLocaleString("he-IL")}
                {lastWipe.data.performed_by_email ? ` · ${lastWipe.data.performed_by_email}` : ""}
              </p>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={wipeMut.isPending}>
                  <Trash2 className="ml-1 h-4 w-4" />
                  {wipeMut.isPending ? "מוחק..." : "ניקוי נתוני דמו"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>למחוק את כל נתוני הדמו?</AlertDialogTitle>
                  <AlertDialogDescription>
                    הפעולה אינה הפיכה. כל המסירות, ההודעות, השגיאות, הבירורים והלקוחות (פרט ל"מזדמנים") יימחקו לצמיתות.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>ביטול</AlertDialogCancel>
                  <AlertDialogAction onClick={() => wipeMut.mutate()}>כן, מחק הכל</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
