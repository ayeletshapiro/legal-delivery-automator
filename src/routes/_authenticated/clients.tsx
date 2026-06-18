import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listClients, createClient, updateClient, archiveClient } from "@/lib/clients.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
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

  const { data, isLoading } = useQuery({ queryKey: ["clients"], queryFn: () => list() });

  const createMut = useMutation({
    mutationFn: (vars: { client_name: string; google_sheet_id?: string | null }) => create({ data: vars }),
    onSuccess: () => { toast.success("לקוח נוסף"); qc.invalidateQueries({ queryKey: ["clients"] }); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: (vars: { id: string; client_name: string; google_sheet_id?: string | null }) => update({ data: vars }),
    onSuccess: () => { toast.success("עודכן"); qc.invalidateQueries({ queryKey: ["clients"] }); setEditing(null); },
    onError: (e: Error) => toast.error(e.message),
  });
  const archiveMut = useMutation({
    mutationFn: (vars: { id: string; archive: boolean }) => archive({ data: vars }),
    onSuccess: () => { toast.success("הסטטוס עודכן"); qc.invalidateQueries({ queryKey: ["clients"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sheet, setSheet] = useState("");
  const [editing, setEditing] = useState<null | { id: string; client_name: string; google_sheet_id: string | null }>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">לקוחות</h2>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>הוסף לקוח</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>לקוח חדש</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2"><Label>שם לקוח</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-2"><Label>Google Sheet ID (אופציונלי)</Label><Input value={sheet} onChange={(e) => setSheet(e.target.value)} dir="ltr" placeholder="ייווצר אוטומטית בהודעה הראשונה" /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => createMut.mutate({ client_name: name, google_sheet_id: sheet || null })} disabled={!name.trim() || createMut.isPending}>שמור</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground">טוען...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">שם</TableHead>
                <TableHead className="text-right">Sheet ID</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.client_name}
                    {c.is_miscellaneous && <Badge variant="secondary" className="mr-2">ברירת מחדל</Badge>}
                  </TableCell>
                  <TableCell dir="ltr" className="text-xs text-muted-foreground">{c.google_sheet_id || <span className="italic">ייווצר אוטומטית</span>}</TableCell>
                  <TableCell>
                    {c.is_archived ? <Badge variant="outline">בארכיון</Badge> : <Badge>פעיל</Badge>}
                  </TableCell>
                  <TableCell className="space-x-2 space-x-reverse">
                    <Button variant="outline" size="sm" onClick={() => setEditing({ id: c.id, client_name: c.client_name, google_sheet_id: c.google_sheet_id })}>ערוך</Button>
                    {!c.is_miscellaneous && (
                      <Button variant="ghost" size="sm" onClick={() => archiveMut.mutate({ id: c.id, archive: !c.is_archived })}>
                        {c.is_archived ? "שחזר" : "ארכב"}
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
          <DialogHeader><DialogTitle>עריכת לקוח</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2"><Label>שם</Label><Input value={editing.client_name} onChange={(e) => setEditing({ ...editing, client_name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Google Sheet ID</Label><Input value={editing.google_sheet_id ?? ""} onChange={(e) => setEditing({ ...editing, google_sheet_id: e.target.value })} dir="ltr" placeholder="ייווצר אוטומטית בהודעה הראשונה" /></div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => editing && updateMut.mutate({ id: editing.id, client_name: editing.client_name, google_sheet_id: editing.google_sheet_id })} disabled={updateMut.isPending}>שמור</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
