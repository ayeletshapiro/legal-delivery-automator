import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  listClients,
  createClient,
  updateClient,
  archiveClient,
  importClientsWithAliases,
} from "@/lib/clients.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/clients")({
  component: ClientsPage,
});

function ClientsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listClients);
  const create = useServerFn(createClient);
  const update = useServerFn(updateClient);
  const archive = useServerFn(archiveClient);
  const importFn = useServerFn(importClientsWithAliases);

  const { data, isLoading } = useQuery({ queryKey: ["clients"], queryFn: () => list() });

  const createMut = useMutation({
    mutationFn: (vars: { client_name: string }) => create({ data: vars }),
    onSuccess: () => {
      toast.success("לקוח נוסף");
      qc.invalidateQueries({ queryKey: ["clients"] });
      setOpen(false);
      setName("");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: (vars: { id: string; client_name: string }) => update({ data: vars }),
    onSuccess: () => {
      toast.success("עודכן");
      qc.invalidateQueries({ queryKey: ["clients"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const archiveMut = useMutation({
    mutationFn: (vars: { id: string; archive: boolean }) => archive({ data: vars }),
    onSuccess: () => {
      toast.success("הסטטוס עודכן");
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const importMut = useMutation({
    mutationFn: (rows: Array<{ client_name: string; alias?: string | null }>) => importFn({ data: { rows } }),
    onSuccess: (r) => {
      toast.success(
        `יובאו: ${r.createdClients} לקוחות חדשים, ${r.createdAliases} כינויים${r.skippedAliases ? `, ${r.skippedAliases} דולגו (קיים)` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["aliases"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<null | { id: string; client_name: string }>(null);
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = (data ?? []).filter((c) => {
    if (filter === "active") return !c.is_archived;
    if (filter === "archived") return c.is_archived;
    return true;
  });

  async function handleFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: "" });
      // Forward-fill column A (client name) so multiple aliases stack under one name
      const rows: Array<{ client_name: string; alias?: string | null }> = [];
      let lastName = "";
      // Detect header row
      const startIdx =
        aoa.length && typeof aoa[0][0] === "string" && /לקוח|client|name/i.test(String(aoa[0][0])) ? 1 : 0;
      for (let i = startIdx; i < aoa.length; i++) {
        const r = aoa[i];
        const n = String(r[0] ?? "").trim();
        const a = String(r[1] ?? "").trim();
        if (n) lastName = n;
        if (!lastName) continue;
        rows.push({ client_name: lastName, alias: a || null });
      }
      if (!rows.length) {
        toast.error("לא נמצאו שורות בקובץ");
        return;
      }
      importMut.mutate(rows);
    } catch (e: any) {
      toast.error("שגיאה בקריאת הקובץ: " + e.message);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold">לקוחות</h2>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importMut.isPending}>
            {importMut.isPending ? "מייבא..." : "ייבוא מאקסל"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>הוסף לקוח</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>לקוח חדש</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>שם לקוח</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createMut.mutate({ client_name: name })}
                  disabled={!name.trim() || createMut.isPending}
                >
                  שמור
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        ייבוא מאקסל: עמודה A — שם לקוח, עמודה B — כינוי. לקוח עם כמה כינויים — מלא כל כינוי בשורה נפרדת, עמודה A יכולה
        להישאר ריקה בשורות הנוספות.
      </p>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">שם</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.client_name}
                    {c.is_miscellaneous && (
                      <Badge variant="secondary" className="mr-2">
                        ברירת מחדל
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.is_archived ? <Badge variant="outline">בארכיון</Badge> : <Badge>פעיל</Badge>}
                  </TableCell>
                  <TableCell className="space-x-2 space-x-reverse">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing({ id: c.id, client_name: c.client_name })}
                    >
                      ערוך
                    </Button>
                    {!c.is_miscellaneous && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => archiveMut.mutate({ id: c.id, archive: !c.is_archived })}
                      >
                        {c.is_archived ? "שחזר" : "לארכיון"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>עריכת לקוח</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>שם</Label>
                <Input
                  value={editing.client_name}
                  onChange={(e) => setEditing({ ...editing, client_name: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              onClick={() => editing && updateMut.mutate({ id: editing.id, client_name: editing.client_name })}
              disabled={updateMut.isPending}
            >
              שמור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
