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
import { Pencil, Trash2, Package, CheckCircle2, Clock, AlertTriangle, FileX } from "lucide-react";

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
  awaiting_clarification: "ממתין להבהרה",
};

/** Map a write_status to a semantic visual style + icon. */
function statusStyle(status: string): { cls: string; Icon: typeof CheckCircle2 } {
  if (status === "נכתב" || status === "written") {
    return { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 };
  }
  if (status === "שגיאה" || status === "failed") {
    return { cls: "bg-red-50 text-red-700 border-red-200", Icon: AlertTriangle };
  }
  if (status === "ללא גיליון") {
    return { cls: "bg-slate-50 text-slate-600 border-slate-200", Icon: FileX };
  }
  // pending / awaiting_clarification / skipped
  return { cls: "bg-amber-50 text-amber-700 border-amber-200", Icon: Clock };
}

function StatusBadge({ status }: { status: string }) {
  const { cls, Icon } = statusStyle(status);
  const label = writeStatusLabels[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

type Delivery = {
  id: string;
  client_id: string;
  delivery_date: string;
  description: string;
  notes: string | null;
  price: number | null;
  price_missing: boolean;
  vat_explicit?: boolean;
  contact_ordered_by: string | null;
  write_status: string;
  created_at: string;
  clients: { client_name: string } | null;
};

/** After-VAT value: only inflate when VAT was explicit; otherwise mirror the price. */
function afterVat(d: Delivery): number {
  const price = d.price ?? 0;
  return d.vat_explicit ? Number((price * 1.18).toFixed(2)) : price;
}

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
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
          <Package className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h2 className="text-xl font-semibold leading-tight">שליחויות</h2>
          <p className="text-sm text-muted-foreground leading-tight">
            {rows ? `${rows.length} שליחויות` : "טוען..."} · היום {today}
          </p>
        </div>
      </div>

      {/* Filters */}
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

      {/* Loading */}
      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">טוען...</Card>
      ) : rows && rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Package className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">אין שליחויות שתואמות את הסינון</p>
        </Card>
      ) : (
        <>
          {/* DESKTOP: table */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">לקוח</TableHead>
                  <TableHead className="text-right">תיאור</TableHead>
                  <TableHead className="text-right">הזמין</TableHead>
                  <TableHead className="text-right">מחיר</TableHead>
                  <TableHead className="text-right">אחרי מע"מ</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows?.map((d) => (
                  <TableRow key={d.id} className="hover:bg-muted/30">
                    <TableCell className="whitespace-nowrap text-xs">{d.delivery_date}</TableCell>
                    <TableCell className="font-medium">{d.clients?.client_name ?? "—"}</TableCell>
                    <TableCell className="max-w-xs">
                      <div className="truncate">{d.description}</div>
                    </TableCell>
                    <TableCell className="text-xs">{d.contact_ordered_by ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {d.price_missing ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          חסר
                        </span>
                      ) : (
                        <span className="font-medium">{d.price} ₪</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {d.price_missing ? "—" : `${afterVat(d)} ₪`}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={d.write_status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(d)} aria-label="עריכה">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setConfirmDel(d)} aria-label="מחיקה">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* MOBILE: cards */}
          <div className="space-y-3 md:hidden">
            {rows?.map((d) => (
              <Card key={d.id} className="p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{d.clients?.client_name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{d.delivery_date}</p>
                  </div>
                  <StatusBadge status={d.write_status} />
                </div>

                <p className="mb-3 text-sm">{d.description}</p>

                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {d.contact_ordered_by && (
                    <span className="text-muted-foreground">
                      הזמין: <span className="text-foreground">{d.contact_ordered_by}</span>
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    מחיר:{" "}
                    {d.price_missing ? (
                      <span className="font-medium text-red-700">חסר</span>
                    ) : (
                      <span className="font-medium text-foreground">{d.price} ₪</span>
                    )}
                  </span>
                  {!d.price_missing && (
                    <span className="text-muted-foreground">
                      אחרי מע"מ: <span className="text-foreground">{afterVat(d)} ₪</span>
                    </span>
                  )}
                </div>

                {d.notes && (
                  <p className="mb-3 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{d.notes}</p>
                )}

                <div className="flex gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(d)}>
                    <Pencil className="ml-1.5 h-4 w-4" />
                    עריכה
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-destructive hover:text-destructive"
                    onClick={() => setConfirmDel(d)}
                  >
                    <Trash2 className="ml-1.5 h-4 w-4" />
                    מחיקה
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

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
