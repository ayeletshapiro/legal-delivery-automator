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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { toast } from "sonner";
import { Users, Plus, Upload, Pencil, Archive, ArchiveRestore, Star } from "lucide-react";

export const Route = createFileRoute("/_authenticated/clients")({
  component: ClientsPage,
});

/** Initials for the avatar (first letters of up to two words). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[1][0];
}

/** Deterministic soft color per client name, for a friendly avatar. */
const AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-700",
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
}

type Client = {
  id: string;
  client_name: string;
  is_archived: boolean;
  is_miscellaneous: boolean;
};

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

  const filtered = ((data ?? []) as Client[]).filter((c) => {
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
      const rows: Array<{ client_name: string; alias?: string | null }> = [];
      let lastName = "";
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

  function StatusBadge({ c }: { c: Client }) {
    if (c.is_archived) {
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          <Archive className="h-3.5 w-3.5" />
          בארכיון
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        פעיל
      </span>
    );
  }

  function Avatar({ name }: { name: string }) {
    return (
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium ${avatarColor(name)}`}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary">
            <Users className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-xl font-semibold leading-tight">לקוחות</h2>
            <p className="text-sm text-muted-foreground leading-tight">
              {data ? `${filtered.length} לקוחות` : "טוען..."}
            </p>
          </div>
        </div>

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
            <Upload className="ml-1.5 h-4 w-4" />
            {importMut.isPending ? "מייבא..." : "ייבוא מאקסל"}
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="ml-1.5 h-4 w-4" />
                הוסף לקוח
              </Button>
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

      {/* Import hint */}
      <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <span className="font-medium">ייבוא מאקסל:</span> עמודה A — שם לקוח, עמודה B — כינוי. לקוח עם כמה כינויים — מלא
        כל כינוי בשורה נפרדת, עמודה A יכולה להישאר ריקה בשורות הנוספות.
      </div>

      {/* Filter */}
      <ToggleGroup
        type="single"
        value={filter}
        onValueChange={(v) => v && setFilter(v as "active" | "archived" | "all")}
        className="justify-start"
      >
        <ToggleGroupItem value="active">פעילים</ToggleGroupItem>
        <ToggleGroupItem value="archived">בארכיון</ToggleGroupItem>
        <ToggleGroupItem value="all">הכל</ToggleGroupItem>
      </ToggleGroup>

      {/* Loading / empty / data */}
      {isLoading ? (
        <Card className="p-8 text-center text-muted-foreground">טוען...</Card>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 p-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
            <Users className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="text-muted-foreground">אין לקוחות להצגה</p>
        </Card>
      ) : (
        <>
          {/* DESKTOP: table */}
          <Card className="hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-right">שם</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id} className="hover:bg-muted/30">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={c.client_name} />
                        <span className="font-medium">{c.client_name}</span>
                        {c.is_miscellaneous && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <Star className="h-3 w-3" />
                            ברירת מחדל
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge c={c} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing({ id: c.id, client_name: c.client_name })}
                        >
                          <Pencil className="ml-1.5 h-4 w-4" />
                          ערוך
                        </Button>
                        {!c.is_miscellaneous && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => archiveMut.mutate({ id: c.id, archive: !c.is_archived })}
                          >
                            {c.is_archived ? (
                              <>
                                <ArchiveRestore className="ml-1.5 h-4 w-4" />
                                שחזר
                              </>
                            ) : (
                              <>
                                <Archive className="ml-1.5 h-4 w-4" />
                                לארכיון
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* MOBILE: cards */}
          <div className="space-y-3 md:hidden">
            {filtered.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="mb-3 flex items-center gap-3">
                  <Avatar name={c.client_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.client_name}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <StatusBadge c={c} />
                      {c.is_miscellaneous && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          <Star className="h-3 w-3" />
                          ברירת מחדל
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 border-t pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setEditing({ id: c.id, client_name: c.client_name })}
                  >
                    <Pencil className="ml-1.5 h-4 w-4" />
                    ערוך
                  </Button>
                  {!c.is_miscellaneous && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => archiveMut.mutate({ id: c.id, archive: !c.is_archived })}
                    >
                      {c.is_archived ? (
                        <>
                          <ArchiveRestore className="ml-1.5 h-4 w-4" />
                          שחזר
                        </>
                      ) : (
                        <>
                          <Archive className="ml-1.5 h-4 w-4" />
                          לארכיון
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Edit dialog */}
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
