import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listDeliveries, updateDelivery, deleteDelivery } from "@/lib/deliveries.functions";
import { listClients } from "@/lib/clients.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/deliveries")({
  component: DeliveriesPage,
});

const writeStatusLabels: Record<string, string> = {
  pending: "ממתין",
  נכתב: "נכתב",
  שגיאה: "שגיאה",
  "ללא גיליון": "ללא גיליון",
  written: "נכתב",
  failed: "כשל בכתיבה",
  skipped: "דולג",
};

type Delivery = {
  id: string;
  client_id: string;
  delivery_date: string;
  description: string;
  notes: string | null;
  price: number | null;
  price_missing: boolean;
  contact_ordered_by: string | null;
  write_status: string;
  created_at: string;
  clients: { client_name: string } | null;
};

function DeliveriesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listDeliveries);
  const clientsFn = useServerFn(listClients);
  const updateFn = useServerFn(updateDelivery);
  const deleteFn = useServerFn(deleteDelivery);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [clientId, setClientId] = useState<string>("all");
  const [writeStatus, setWriteStatus] = useState<string>("all");

  const filters = {
    from: from || null,
    to: to || null,
    client_id: clientId === "all" ? null : clientId,
    write_status: writeStatus === "all" ? null : writeStatus,
  };

  const { data: rows, isLoading } = useQuery({
    queryKey: ["deliveries", filters],
    queryFn: () => listFn({ data: filters }) as Promise<Delivery[]>,
  });
  const { data: clients } = useQuery({
    queryKey: ["clients"],
    queryFn: () => clientsFn(),
  });

  const [editing, setEditing] = useState<Delivery | null>(null);
  const [confirmDel, setConfirmDel] = useState<Delivery | null>(null);

  const updMut = useMutation({
    mutationFn: (p: Parameters<typeof updateFn>[0]["data"]) => updateFn({ data: p }),
    onSuccess: () => {
      toast.success("נשמר");
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("נמחק");
      qc.invalidateQueries({ queryKey: ["deliveries"] });
      setConfirmDel(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-2xl font-bold">שליחויות</h2>
        <div className="text-sm text-muted-foreground">היום: {today}</div>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">מתאריך</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">עד תאריך</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">לקוח</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {clients?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.client_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">סטטוס כתיבה</Label>
            <Select value={writeStatus} onValueChange={setWriteStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                {Object.entries(writeStatusLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">לקוח</TableHead>
                <TableHead className="text-right">תיאור</TableHead>
                <TableHead className="text-right">הזמין</TableHead>
                <TableHead className="text-right">הערות</TableHead>
                <TableHead className="text-right">מחיר</TableHead>
                <TableHead className="text-right">סה"כ ללא מע"מ</TableHead>
                <TableHead className="text-right">סה"כ אחרי מע"מ</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((d) => {
                const price = d.price ?? 0;
                const totalAfterVat = Number((price * 1.18).toFixed(2));
                return (
                  <TableRow key={d.id}>
                    <TableCell className="text-xs whitespace-nowrap">{d.delivery_date}</TableCell>
                    <TableCell className="font-medium">{d.clients?.client_name ?? "—"}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="truncate">{d.description}</div>
                    </TableCell>
                    <TableCell className="text-xs">{d.contact_ordered_by ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-xs truncate">{d.notes ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {d.price_missing ? <Badge variant="destructive">חסר</Badge> : <span>{d.price} ₪</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {d.price_missing ? "—" : `${price} ₪`}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{d.price_missing ? "—" : `${totalAfterVat} ₪`}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{writeStatusLabels[d.write_status] ?? d.write_status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(d)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setConfirmDel(d)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                    אין משלוחים
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {editing && (
        <EditDialog
          delivery={editing}
          clients={clients ?? []}
          onClose={() => setEditing(null)}
          onSave={(patch) => updMut.mutate({ id: editing.id, ...patch })}
          saving={updMut.isPending}
        />
      )}

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>למחוק משלוח?</AlertDialogTitle>
            <AlertDialogDescription>{confirmDel?.description} — פעולה זו אינה הפיכה.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDel && delMut.mutate(confirmDel.id)}>מחק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditDialog({
  delivery,
  clients,
  onClose,
  onSave,
  saving,
}: {
  delivery: Delivery;
  clients: { id: string; client_name: string }[];
  onClose: () => void;
  onSave: (p: {
    client_id: string;
    delivery_date: string;
    description: string;
    notes: string | null;
    price: number | null;
    contact_ordered_by: string | null;
    write_status: string;
  }) => void;
  saving: boolean;
}) {
  const [clientId, setClientId] = useState(delivery.client_id);
  const [date, setDate] = useState(delivery.delivery_date);
  const [desc, setDesc] = useState(delivery.description);
  const [notes, setNotes] = useState(delivery.notes ?? "");
  const [price, setPrice] = useState<string>(delivery.price?.toString() ?? "");
  const [orderedBy, setOrderedBy] = useState(delivery.contact_ordered_by ?? "");
  const [ws, setWs] = useState(delivery.write_status);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>עריכת משלוח</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>לקוח</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.client_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>תאריך</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" />
          </div>
          <div className="space-y-1">
            <Label>תיאור</Label>
            <Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>הערות</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>מחיר (₪)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="space-y-1">
              <Label>הזמין</Label>
              <Input value={orderedBy} onChange={(e) => setOrderedBy(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>סטטוס</Label>
            <Select value={ws} onValueChange={setWs}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(writeStatusLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ביטול
          </Button>
          <Button
            disabled={saving || !desc.trim() || !date}
            onClick={() =>
              onSave({
                client_id: clientId,
                delivery_date: date,
                description: desc.trim(),
                notes: notes.trim() || null,
                price: price.trim() === "" ? null : Number(price),
                contact_ordered_by: orderedBy.trim() || null,
                write_status: ws,
              })
            }
          >
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
