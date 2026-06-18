import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getConfig, updateVatRate } from "@/lib/config.functions";
import { getProfile, updateWhatsappPhone } from "@/lib/profile.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const cfgFn = useServerFn(getConfig);
  const vatFn = useServerFn(updateVatRate);
  const profFn = useServerFn(getProfile);
  const phoneFn = useServerFn(updateWhatsappPhone);

  const cfg = useQuery({ queryKey: ["config"], queryFn: () => cfgFn() });
  const prof = useQuery({ queryKey: ["profile"], queryFn: () => profFn() });

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
    onSuccess: () => { toast.success('מע"מ עודכן'); qc.invalidateQueries({ queryKey: ["config"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const phoneMut = useMutation({
    mutationFn: (p: string | null) => phoneFn({ data: { whatsapp_phone: p } }),
    onSuccess: () => { toast.success("טלפון עודכן"); qc.invalidateQueries({ queryKey: ["profile"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const isAdmin = prof.data?.roles.includes("admin");

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold">הגדרות</h2>

      <Card>
        <CardHeader>
          <CardTitle>הפרופיל שלי</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            {prof.data?.profile?.email} {isAdmin && <Badge className="mr-2">אדמין</Badge>}
          </div>
          <div className="space-y-2">
            <Label>מספר WhatsApp אישי</Label>
            <div className="flex gap-2">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="+972..." />
              <Button onClick={() => phoneMut.mutate(phone || null)} disabled={phoneMut.isPending}>שמור</Button>
            </div>
            <p className="text-xs text-muted-foreground">משמש לזיהוי הודעות נכנסות בעתיד.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>מע"מ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>אחוז מע"מ (%)</Label>
            <div className="flex gap-2">
              <Input type="number" min="0" max="100" step="0.01" value={vatPct} onChange={(e) => setVatPct(e.target.value)} dir="ltr" disabled={!isAdmin} />
              <Button onClick={() => vatMut.mutate(Number(vatPct) / 100)} disabled={!isAdmin || vatMut.isPending}>שמור</Button>
            </div>
            {!isAdmin && <p className="text-xs text-muted-foreground">רק אדמין יכול לשנות.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
